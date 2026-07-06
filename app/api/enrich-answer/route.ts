// byte's first-chat enrichment — the distill+persist half. The client walks the founder
// through the ≤3 plan-shaping questions (goal / traction / problem); each free-text reply
// is POSTed here, byte distills it into the matching brief field grounded ONLY in what the
// founder said, and it's persisted immediately so a mid-interview drop-off still keeps every
// answered field. The gap detection + question copy live in the pure lib/ai/enrichInterview.
//
// Auth-gated and behind the same per-user daily cost guard as the other AI routes.
import { verifyIdToken } from '@/lib/firebase/admin';
import { loadServerBrief, writeServerBrief } from '@/lib/firebase/serverBrief';
import { enforceDailyLimit, usageSink } from '@/lib/firebase/serverUsage';
import { getClient, generateJson, aiErrorResponse } from '@/lib/ai/client';
import {
  INTERVIEW_SCHEMA,
  buildDistillPrompt,
  mergeAnswer,
  GAP_ORDER,
  type Gap,
  type InterviewAnswer,
} from '@/lib/ai/enrichInterview';
import type { CompanyBrief } from '@/lib/firebase/schema';

export const runtime = 'nodejs';

const DISTILL_SYSTEM =
  "You read a founder's short answer to one onboarding question and capture it as a concise field value, in their own words and with their real numbers kept exact. You never invent, embellish, or add anything they did not say; if the reply has no real answer, you return an empty string.";

interface Body {
  gap?: unknown;
  answer?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  const authz = req.headers.get('authorization') ?? '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  if (!idToken) return Response.json({ error: 'unauthorized' }, { status: 401 });
  let uid: string;
  try {
    uid = (await verifyIdToken(idToken)).uid;
  } catch {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let client: ReturnType<typeof getClient>;
  try {
    client = getClient();
  } catch (err) {
    return aiErrorResponse(err, 'not_configured');
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const gap = typeof body.gap === 'string' ? (body.gap as Gap) : null;
  if (!gap || !GAP_ORDER.includes(gap)) {
    return Response.json({ error: 'bad_request', message: 'unknown gap' }, { status: 400 });
  }
  const answer = typeof body.answer === 'string' ? body.answer.trim() : '';
  // An empty reply is a legitimate skip — nothing to distill, nothing to persist.
  if (!answer) return Response.json({ saved: false, gap });

  // Same per-user daily cost guard as the other AI routes; fail-open on infra.
  const limit = await enforceDailyLimit(uid, idToken, new Date());
  if (!limit.ok) {
    return Response.json(
      { error: 'rate_limited', limit: limit.limit },
      { status: 429, headers: { 'retry-after': '3600' } },
    );
  }

  // Load the founder's real brief so we never override a field they already filled.
  const loaded = await loadServerBrief(uid, idToken);
  const brief: CompanyBrief =
    loaded && typeof loaded === 'object' ? (loaded as CompanyBrief) : {};

  try {
    const distilled = await generateJson<InterviewAnswer>({
      client,
      system: DISTILL_SYSTEM,
      prompt: buildDistillPrompt(gap, answer),
      maxTokens: 512,
      label: `enrich-answer:${gap}`,
      schema: INTERVIEW_SCHEMA,
      onUsage: usageSink(uid, idToken, 'enrichAnswer'),
    });
    const merged = mergeAnswer(brief, gap, distilled);
    // Only touch Firestore when the merge actually changed the field.
    if (merged[gap] !== brief[gap]) {
      await writeServerBrief(uid, idToken, merged);
      return Response.json({ saved: true, gap, value: merged[gap] });
    }
    return Response.json({ saved: false, gap });
  } catch (err) {
    return aiErrorResponse(err, 'generate_failed');
  }
}
