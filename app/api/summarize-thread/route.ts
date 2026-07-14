// Rolling per-thread summary — the fold+return half. When a chat thread grows past the
// visible window (MAX_CHAT_TURNS), the client batches the turns that just scrolled out of
// view and POSTs them here with the summary so far; byte folds them into an updated running
// summary, which the client persists on the thread and passes back on later chat calls so
// long threads keep their earlier context. The decision of WHICH turns to fold is pure
// (lib/ai/threadSummary.planThreadSummary); this route only runs the model call.
//
// Auth-gated and behind the same per-user daily cost guard as the other AI routes.
import { verifyIdToken } from '@/lib/firebase/admin';
import { enforceDailyLimit, usageSink } from '@/lib/firebase/serverUsage';
import { getClient, generateText, aiErrorResponse, LIGHT_MODEL } from '@/lib/ai/client';
import { SUMMARY_SYSTEM, buildSummaryPrompt } from '@/lib/ai/threadSummary';
import type { ChatTurn } from '@/lib/ai/chatMessages';

export const runtime = 'nodejs';

interface Body {
  priorSummary?: unknown;
  turns?: unknown;
}

// Guard the fold input so one call can't be blown up by a pathological payload.
const MAX_TURNS = 60;
const MAX_TURN_CHARS = 2000;

function parseTurns(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: ChatTurn[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const role = (t as { role?: unknown }).role;
    const text = (t as { text?: unknown }).text;
    if ((role !== 'me' && role !== 'byte') || typeof text !== 'string') continue;
    const trimmed = text.trim();
    if (!trimmed) continue;
    turns.push({ role, text: trimmed.slice(0, MAX_TURN_CHARS) });
    if (turns.length >= MAX_TURNS) break;
  }
  return turns;
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

  const priorSummary = typeof body.priorSummary === 'string' ? body.priorSummary : '';
  const turns = parseTurns(body.turns);
  // Nothing to fold → nothing to do (client keeps the prior summary).
  if (turns.length === 0) return Response.json({ summary: priorSummary });

  // Same per-user daily cost guard as the other AI routes; fail-open on infra.
  const limit = await enforceDailyLimit(uid, idToken, new Date());
  if (!limit.ok) {
    return Response.json(
      { error: 'rate_limited', limit: limit.limit },
      { status: 429, headers: { 'retry-after': '3600' } },
    );
  }

  try {
    const summary = await generateText({
      client,
      system: SUMMARY_SYSTEM,
      prompt: buildSummaryPrompt(priorSummary, turns),
      maxTokens: 512,
      label: 'summarize-thread',
      // Condensing a batch of turns into a paragraph → the cheaper tier.
      model: LIGHT_MODEL,
      onUsage: usageSink(uid, idToken, 'summarizeThread'),
    });
    return Response.json({ summary: summary.trim() });
  } catch (err) {
    return aiErrorResponse(err, 'generate_failed');
  }
}
