// Phase 3 — byte's task loop, made real. This server route calls the Claude API
// to generate a deliverable from the user's company context + the task. The
// ANTHROPIC_API_KEY stays server-side (never NEXT_PUBLIC). Node runtime so the
// official SDK runs.
//
// Kinds:
//   text                          → plain-text deliverable, returns { text }
//   post/email/legal/screens/sheet/site → structured deliverable via output_config.format, returns { payload }
// All kinds support a revise pass (reviseNote + current draft).
import Anthropic from '@anthropic-ai/sdk';
import { verifyIdToken } from '@/lib/firebase/admin';
import { briefToContext } from '@/lib/ai/brief';
import { loadServerBrief } from '@/lib/firebase/serverBrief';
import { enforceDailyLimit } from '@/lib/firebase/serverUsage';
import {
  STRUCTURED_SCHEMAS,
  DELIVERABLE_INSTRUCTIONS,
  type StructuredKind,
} from '@/lib/ai/deliverableSchemas';

export const runtime = 'nodejs';

// byte's voice + output contract.
const BYTE_SYSTEM = `You are byte, the AI building companion inside Codepet. You produce real, ready-to-use deliverables for a founder building their company with AI — not descriptions of deliverables.

Voice: warm, plain-language, confident, specific. No hype, no emoji, no clichés. Write the thing the founder will actually use.`;

// Baseline company context. Phase 4 will swap this for the user's real business
// brief once onboarding persists it; until then byte writes from the product.
const CODEPET_CONTEXT = `Codepet is a macOS companion that builds your whole company with you, department by department. It reads your project, writes the business brief and roadmap, then does real work across Engineering, Marketing, Design, Finance, Operations, Legal, Sales, and Support — producing real deliverables you approve. The promise is comprehension plus control: a real company, and one you actually understand.`;

// Structured-output schemas + prompt instructions live in a pure, unit-tested
// module (lib/ai/deliverableSchemas.ts). `text` has no schema (plain text).
type Kind = 'text' | StructuredKind;

const KINDS: Record<Kind, { schema: Record<string, unknown> | null; instruction: string }> = {
  text: { schema: null, instruction: DELIVERABLE_INSTRUCTIONS.text },
  post: { schema: STRUCTURED_SCHEMAS.post, instruction: DELIVERABLE_INSTRUCTIONS.post },
  email: { schema: STRUCTURED_SCHEMAS.email, instruction: DELIVERABLE_INSTRUCTIONS.email },
  legal: { schema: STRUCTURED_SCHEMAS.legal, instruction: DELIVERABLE_INSTRUCTIONS.legal },
  screens: { schema: STRUCTURED_SCHEMAS.screens, instruction: DELIVERABLE_INSTRUCTIONS.screens },
  sheet: { schema: STRUCTURED_SCHEMAS.sheet, instruction: DELIVERABLE_INSTRUCTIONS.sheet },
  site: { schema: STRUCTURED_SCHEMAS.site, instruction: DELIVERABLE_INSTRUCTIONS.site },
};

interface RunTaskBody {
  kind?: unknown;
  taskTitle?: unknown;
  taskHint?: unknown;
  deptName?: unknown;
  reviseNote?: unknown;
  current?: unknown;
  brief?: unknown;
}

function buildPrompt(
  kind: Kind,
  context: string,
  fields: {
    taskTitle: string;
    taskHint?: string;
    deptName?: string;
    reviseNote?: string;
    current?: string;
  },
): string {
  const { taskTitle, taskHint, deptName, reviseNote, current } = fields;
  const lines = [
    `Company context: ${context}`,
    '',
    deptName ? `Department: ${deptName}` : null,
    `Task: ${taskTitle}`,
    taskHint ? `Intended deliverable: ${taskHint}` : null,
    '',
    KINDS[kind].instruction,
  ];

  if (reviseNote && current) {
    lines.push(
      '',
      'You previously produced this draft:',
      '---',
      current,
      '---',
      `Revise it to address this feedback: ${reviseNote}`,
      'Return the full revised deliverable (not a diff).',
    );
  } else {
    lines.push('', 'Produce the deliverable now.');
  }
  return lines.filter((l) => l !== null).join('\n');
}

export async function POST(req: Request): Promise<Response> {
  // Require a valid Firebase ID token — the endpoint calls a paid API, so it
  // must not be reachable by unauthenticated clients.
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

  let body: RunTaskBody;
  try {
    body = (await req.json()) as RunTaskBody;
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const kind: Kind =
    typeof body.kind === 'string' && body.kind in KINDS ? (body.kind as Kind) : 'text';
  const taskTitle = typeof body.taskTitle === 'string' ? body.taskTitle.trim() : '';
  if (!taskTitle) {
    return Response.json(
      { error: 'bad_request', message: 'taskTitle is required.' },
      { status: 400 },
    );
  }
  const fields = {
    taskTitle,
    taskHint: typeof body.taskHint === 'string' ? body.taskHint.slice(0, 400) : undefined,
    deptName: typeof body.deptName === 'string' ? body.deptName : undefined,
    reviseNote: typeof body.reviseNote === 'string' ? body.reviseNote.slice(0, 400) : undefined,
    current: typeof body.current === 'string' ? body.current.slice(0, 6000) : undefined,
  };

  // Per-user daily cost guard: count this attempt and stop if the account is over
  // its cap (fail-open if the counter is unavailable — never block on infra).
  const limit = await enforceDailyLimit(uid, idToken, new Date());
  if (!limit.ok) {
    return Response.json(
      { error: 'rate_limited', limit: limit.limit },
      { status: 429, headers: { 'retry-after': '3600' } },
    );
  }

  // Prefer the caller's REAL persisted brief (loaded by the verified uid) over
  // whatever the client passed, so generation is always scoped to the signed-in
  // account; fall back to the client brief (e.g. mid-onboarding) then the baseline.
  const serverBrief = await loadServerBrief(uid, idToken);
  const context = briefToContext(serverBrief) ?? briefToContext(body.brief) ?? CODEPET_CONTEXT;
  const { schema } = KINDS[kind];
  const client = new Anthropic({ apiKey });

  try {
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: 'claude-opus-4-8',
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      output_config: schema
        ? { effort: 'low', format: { type: 'json_schema', schema } }
        : { effort: 'low' },
      system: BYTE_SYSTEM,
      messages: [{ role: 'user', content: buildPrompt(kind, context, fields) }],
    };
    const message = await client.messages.create(params);

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

    if (schema) {
      try {
        return Response.json({ payload: JSON.parse(text) });
      } catch {
        console.error('[run-task] structured output was not valid JSON');
        return Response.json({ error: 'parse_failed' }, { status: 502 });
      }
    }
    return Response.json({ text });
  } catch (err) {
    console.error('[run-task] generation failed', err);
    const status = err instanceof Anthropic.APIError ? (err.status ?? 502) : 502;
    return Response.json({ error: 'generation_failed' }, { status });
  }
}
