// Phase 5.3 — one-time seed templating. Right after onboarding, byte rewrites the
// department/task TEXT (each dept's `need` + `byte`, and every task's title `t` and
// description `d`) so a new account opens into ITS OWN company instead of the
// hardcoded Codepet seed. Scope is deliberately text-only: the `out` fallback and all
// rich payloads (site/sheet/post/email/legal/…) stay as seed — the live run loop in
// /api/run-task already regenerates real deliverables from the brief at run time.
//
// Like /api/run-task, this is auth-gated, holds the Anthropic key server-side, and
// loads the brief from Firestore by the VERIFIED uid (client brief only as fallback).
// The canonical structure comes from DEPTS_SEED on the server — never the client — so
// the response always maps cleanly back onto the seed by department key + task index.
import Anthropic from '@anthropic-ai/sdk';
import { verifyIdToken } from '@/lib/firebase/admin';
import { briefToContext } from '@/lib/ai/brief';
import { loadServerBrief } from '@/lib/firebase/serverBrief';
import { DEPTS_SEED } from '@/lib/data';

export const runtime = 'nodejs';

const BYTE_SYSTEM = `You are byte, the AI building companion inside Codepet. You are setting up a founder's company for the first time, rewriting a generic department plan so it is specifically about THEIR company.

Voice: warm, plain-language, confident, specific. No hype, no emoji, no clichés. Speak as byte ("I'll…", "let's…") in the byte-narration field, exactly as the originals do.`;

// Personalized text, keyed back to the seed by department `k` and task order.
const PERSONALIZE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    departments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          k: { type: 'string', description: 'The department key, copied verbatim from the input.' },
          need: {
            type: 'string',
            description:
              "The one-sentence statement of what this department needs to do for THIS company. Same intent as the original, re-aimed at the founder's product.",
          },
          byte: {
            type: 'string',
            description:
              "byte's short first-person note about how it will help in this department, in byte's voice.",
          },
          tasks: {
            type: 'array',
            description: 'Same number of tasks as the input, in the same order.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                t: {
                  type: 'string',
                  description:
                    "The task title, rewritten for this company. Keep the task's underlying intent/type (a landing-page task stays a landing-page task).",
                },
                d: {
                  type: 'string',
                  description: 'The one-line task description, rewritten for this company.',
                },
              },
              required: ['t', 'd'],
            },
          },
        },
        required: ['k', 'need', 'byte', 'tasks'],
      },
    },
  },
  required: ['departments'],
};

interface PersonalizeBody {
  brief?: unknown;
}

interface GenDept {
  k: string;
  need: string;
  byte: string;
  tasks: Array<{ t: string; d: string }>;
}

// The seed skeleton byte personalizes — only the text fields, so the prompt stays
// small and byte can't drift the structure (counts/keys come back to us to validate).
function seedSkeleton() {
  return DEPTS_SEED.map((d) => ({
    k: d.k,
    name: d.name,
    need: d.need,
    byte: d.byte,
    tasks: d.tasks.map((t) => ({ t: t.t, d: t.d ?? '' })),
  }));
}

function buildPrompt(context: string): string {
  return [
    `You are setting up the company below. Here is what byte knows about it:`,
    context,
    '',
    `Here is the generic department plan to personalize, as JSON:`,
    JSON.stringify(seedSkeleton()),
    '',
    `Rewrite it for this company. Rules:`,
    `- Return EVERY department, with its key (k) copied exactly.`,
    `- Keep the same number of tasks per department, in the same order.`,
    `- Preserve each task's underlying intent and type — only re-aim it at this company (e.g. a "build the landing page" task stays a landing-page task, a legal-policy task stays a legal-policy task).`,
    `- Rewrite need, byte, and each task's t and d so they are concretely about this founder's product, audience, and stage. Use the real product/company name where the originals used a placeholder.`,
    `- Keep byte's warm, specific, first-person voice in the byte field. No emoji, no hype.`,
    `Produce the personalized plan now.`,
  ].join('\n');
}

export async function POST(req: Request): Promise<Response> {
  const authz = req.headers.get('authorization') ?? '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  if (!idToken) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  let uid: string;
  try {
    const decoded = await verifyIdToken(idToken);
    uid = decoded.uid;
  } catch {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'not_configured', message: 'ANTHROPIC_API_KEY is not set on the server.' },
      { status: 503 },
    );
  }

  let body: PersonalizeBody = {};
  try {
    body = (await req.json()) as PersonalizeBody;
  } catch {
    // Body is optional — the brief is preferentially loaded server-side anyway.
  }

  // Prefer the caller's REAL persisted brief (loaded by the verified uid) over the
  // client-passed brief (used right after onboarding before the read settles). No
  // brief at all ⇒ nothing to personalize: return an empty plan so the client keeps
  // the seed.
  const serverBrief = await loadServerBrief(uid, idToken);
  const context = briefToContext(serverBrief) ?? briefToContext(body.brief);
  if (!context) {
    return Response.json({ departments: [] });
  }

  const client = new Anthropic({ apiKey });
  try {
    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 8192,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema: PERSONALIZE_SCHEMA } },
      system: BYTE_SYSTEM,
      messages: [{ role: 'user', content: buildPrompt(context) }],
    });

    if (message.stop_reason === 'refusal') {
      return Response.json({ error: 'refused' }, { status: 422 });
    }

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
    if (!text) {
      return Response.json({ error: 'empty' }, { status: 502 });
    }

    let parsed: { departments?: GenDept[] };
    try {
      parsed = JSON.parse(text) as { departments?: GenDept[] };
    } catch {
      console.error('[personalize] structured output was not valid JSON');
      return Response.json({ error: 'parse_failed' }, { status: 502 });
    }

    // Keep only departments whose key matches the seed and whose task count lines up,
    // so the client can merge by key + index without ever corrupting the structure.
    const byKey = new Map(DEPTS_SEED.map((d) => [d.k, d.tasks.length]));
    const departments = (parsed.departments ?? []).filter(
      (d): d is GenDept =>
        !!d &&
        typeof d.k === 'string' &&
        byKey.has(d.k) &&
        Array.isArray(d.tasks) &&
        d.tasks.length === byKey.get(d.k),
    );

    return Response.json({ departments });
  } catch (err) {
    console.error('[personalize] generation failed', err);
    const status = err instanceof Anthropic.APIError ? (err.status ?? 502) : 502;
    return Response.json({ error: 'generation_failed' }, { status });
  }
}
