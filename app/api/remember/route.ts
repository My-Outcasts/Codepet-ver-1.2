// Phase 2 of the decisions layer — the byte-maintained writer. The client calls this
// (fire-and-forget) right after the founder approves a deliverable. byte extracts any
// durable decision the deliverable locks in and merges it into the company memory that
// the project model reads back. Everything is best-effort and non-blocking: the approval
// already happened client-side, so this route never affects what the founder saw.
//
// Gated behind AI_MEMORY_ENABLED so the per-approval extraction cost is opt-in. Uses a
// cheaper model (Sonnet 5) than the Opus generation routes — extraction is simple — via
// the central client's model override, and reports usage under the `memory` key.
import { verifyIdToken } from '@/lib/firebase/admin';
import { loadServerCompany } from '@/lib/firebase/serverCompany';
import { writeServerDecisions } from '@/lib/firebase/serverDecisions';
import { usageSink } from '@/lib/firebase/serverUsage';
import { getClient, generateJson, LIGHT_MODEL } from '@/lib/ai/client';
import { aiClientFor } from '@/lib/firebase/serverUserKey';
import {
  DECISIONS_EXTRACT_SCHEMA,
  buildExtractPrompt,
  mergeDecisions,
  type ExtractedDecision,
  type ApprovedDeliverable,
} from '@/lib/ai/decisions';

export const runtime = 'nodejs';

const EXTRACT_SYSTEM = `You extract durable company decisions from a deliverable a founder just approved. A decision is an explicit, lasting choice — about pricing, positioning, naming, target audience, tech, brand voice, or scope — that should constrain the company's future work.

Only extract decisions that are EXPLICIT and durable. Ignore transient details, task lists, examples, and anything speculative or clearly a draft. Reuse an existing topic when the deliverable CHANGES a decision already on record; never re-emit an unchanged one. If the deliverable locks in no clear new decision, return an empty list. Prefer few, high-confidence decisions over many shaky ones.`;

interface RememberBody {
  deliverable?: {
    title?: unknown;
    dept?: unknown;
    type?: unknown;
    out?: unknown;
  };
}

function parseDeliverable(body: RememberBody): ApprovedDeliverable | null {
  const d = body.deliverable;
  if (!d || typeof d !== 'object') return null;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const title = str(d.title);
  const out = str(d.out);
  // Need a title and some content to extract anything meaningful.
  if (!title || !out) return null;
  return { title, dept: str(d.dept), type: str(d.type), out };
}

export async function POST(req: Request): Promise<Response> {
  // Best-effort telemetry-style endpoint: authenticate, but on any failure just return
  // ok so the client's fire-and-forget call is always harmless.
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

  // Less-important background extraction — offload to the user's OWN key when set, else Codepet's.
  // Uncapped. Fail-open (a resolve error just uses the platform key).
  let client: ReturnType<typeof getClient>;
  try {
    client = (await aiClientFor(uid)).client;
  } catch {
    return Response.json({ ok: true, skipped: 'not_configured' });
  }

  let body: RememberBody;
  try {
    body = (await req.json()) as RememberBody;
  } catch {
    return Response.json({ ok: true, skipped: 'bad_request' });
  }
  const deliverable = parseDeliverable(body);
  if (!deliverable) return Response.json({ ok: true, skipped: 'no_deliverable' });

  try {
    const { decisions: existing } = await loadServerCompany(uid, idToken);
    const { decisions: extracted } = await generateJson<{ decisions: ExtractedDecision[] }>({
      client,
      model: LIGHT_MODEL,
      system: EXTRACT_SYSTEM,
      prompt: buildExtractPrompt(deliverable, existing),
      maxTokens: 1024,
      label: 'memory',
      schema: DECISIONS_EXTRACT_SCHEMA,
      onUsage: usageSink(uid, idToken, 'memory'),
    });

    const clean = Array.isArray(extracted) ? extracted : [];
    if (clean.length === 0) return Response.json({ ok: true, added: 0 });

    const merged = mergeDecisions(existing, clean, Date.now());
    const wrote = await writeServerDecisions(uid, idToken, merged);
    return Response.json({ ok: true, added: clean.length, total: merged.length, persisted: wrote });
  } catch (err) {
    // Refusal, upstream error, write failure — all non-fatal. Log and move on.
    console.error('[remember] extraction failed', err);
    return Response.json({ ok: true, skipped: 'error' });
  }
}
