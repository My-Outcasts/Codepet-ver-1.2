// Chat → durable memory (the model + persistence half). The client fires this
// (fire-and-forget) after a founder chat message. byte extracts any durable decision or
// material fact the founder just stated and merges it into the SAME company memory the
// deliverable-approval writer (/api/remember) feeds and composeProjectModel grounds on —
// so what the founder tells byte in chat shapes every later chat + run-task call instead of
// evaporating. Returns the newly-captured entries so the client can show "Noted" chips.
//
// Best-effort and non-blocking, gated behind AI_MEMORY_ENABLED, on the cheaper Sonnet 5
// tier (extraction is simple), usage reported under the `memory` key — same as /api/remember.
import { verifyIdToken } from '@/lib/firebase/admin';
import { loadServerCompany } from '@/lib/firebase/serverCompany';
import { writeServerDecisions } from '@/lib/firebase/serverDecisions';
import { usageSink } from '@/lib/firebase/serverUsage';
import { getClient, generateJson } from '@/lib/ai/client';
import { mergeDecisions, type ExtractedDecision } from '@/lib/ai/decisions';
import { CHAT_MEMORY_SCHEMA, buildChatExtractPrompt, worthExtracting } from '@/lib/ai/chatMemory';

export const runtime = 'nodejs';

const EXTRACT_MODEL = 'claude-sonnet-5';

const EXTRACT_SYSTEM = `You read one message a founder typed to byte in chat and extract any durable decision or material fact they stated about their company — the kind that should shape byte's future work (traction, goals, milestones, pricing, positioning, naming, audience, tech, scope, timeline).

Extract only what is EXPLICIT and durable. Ignore questions, requests to byte, opinions, drafts, and small talk. Capture the founder's real numbers and specifics exactly; never invent or embellish. Reuse an existing topic when the message UPDATES it (e.g. a newer waitlist count). If the message states nothing durable, return an empty list. Prefer few, high-confidence items over many shaky ones.`;

interface Body {
  message?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  // Best-effort telemetry-style endpoint: authenticate, but on any failure just return ok
  // so the client's fire-and-forget call is always harmless.
  const authz = req.headers.get('authorization') ?? '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  if (!idToken) return Response.json({ error: 'unauthorized' }, { status: 401 });
  let uid: string;
  try {
    uid = (await verifyIdToken(idToken)).uid;
  } catch {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Feature flag — off by default, so shipping this is inert until you opt in.
  if (process.env.AI_MEMORY_ENABLED !== 'true') {
    return Response.json({ ok: true, skipped: 'disabled' });
  }

  let client: ReturnType<typeof getClient>;
  try {
    client = getClient();
  } catch {
    return Response.json({ ok: true, skipped: 'not_configured' });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ ok: true, skipped: 'bad_request' });
  }
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  // Cheap gate before spending a model call — obvious no-signal messages are skipped.
  if (!message || !worthExtracting(message)) {
    return Response.json({ ok: true, skipped: 'no_signal' });
  }

  try {
    const { decisions: existing } = await loadServerCompany(uid, idToken);
    const { memory: extracted } = await generateJson<{ memory: ExtractedDecision[] }>({
      client,
      model: EXTRACT_MODEL,
      system: EXTRACT_SYSTEM,
      prompt: buildChatExtractPrompt(message, existing),
      maxTokens: 1024,
      label: 'memory',
      schema: CHAT_MEMORY_SCHEMA,
      onUsage: usageSink(uid, idToken, 'memory'),
    });

    const clean = Array.isArray(extracted) ? extracted : [];
    if (clean.length === 0) return Response.json({ ok: true, captured: [] });

    const merged = mergeDecisions(existing, clean, Date.now());
    const wrote = await writeServerDecisions(uid, idToken, merged);

    // Report only the entries that are genuinely new or changed vs. what was on record,
    // so the client's "Noted" chips reflect what actually stuck (not unchanged repeats).
    const before = new Map(existing.map((d) => [d.topic.trim().toLowerCase(), d.statement.trim()]));
    const captured = clean
      .map((e) => ({ topic: (e.topic ?? '').trim(), statement: (e.statement ?? '').trim() }))
      .filter((e) => e.topic && e.statement && before.get(e.topic.toLowerCase()) !== e.statement);

    return Response.json({ ok: true, captured, persisted: wrote });
  } catch (err) {
    console.error('[remember-chat] extraction failed', err);
    return Response.json({ ok: true, skipped: 'error' });
  }
}
