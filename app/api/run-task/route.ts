// Phase 3 — byte's task loop, made real. This server route calls the Claude API
// to generate a deliverable from the user's company context + the task. The
// ANTHROPIC_API_KEY stays server-side (never NEXT_PUBLIC). Node runtime so the
// official SDK runs.
//
// Kinds:
//   text          → plain-text deliverable, returns { text }
//   post/email/legal → structured deliverable via output_config.format, returns { payload }
// All kinds support a revise pass (reviseNote + current draft).
import Anthropic from '@anthropic-ai/sdk';
import { verifyIdToken } from '@/lib/firebase/admin';

export const runtime = 'nodejs';

// byte's voice + output contract.
const BYTE_SYSTEM = `You are byte, the AI building companion inside Codepet. You produce real, ready-to-use deliverables for a founder building their company with AI — not descriptions of deliverables.

Voice: warm, plain-language, confident, specific. No hype, no emoji, no clichés. Write the thing the founder will actually use.`;

// Baseline company context. Phase 4 will swap this for the user's real business
// brief once onboarding persists it; until then byte writes from the product.
const CODEPET_CONTEXT = `Codepet is a macOS companion that builds your whole company with you, department by department. It reads your project, writes the business brief and roadmap, then does real work across Engineering, Marketing, Design, Finance, Operations, Legal, Sales, and Support — producing real deliverables you approve. The promise is comprehension plus control: a real company, and one you actually understand.`;

// ---- structured-output schemas (must satisfy the strict JSON-schema subset:
// additionalProperties:false + every property required). ----
const POST_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    variants: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: {
            type: 'string',
            description: 'The hook angle, 1-3 words (e.g. "Bold", "Problem-first").',
          },
          body: {
            type: 'string',
            description: 'The full social post, under ~280 characters, no hashtag spam.',
          },
        },
        required: ['label', 'body'],
      },
    },
  },
  required: ['variants'],
};

const EMAIL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    subject: { type: 'string' },
    preheader: { type: 'string', description: 'Short inbox preview line.' },
    body: {
      type: 'array',
      items: { type: 'string' },
      description: 'Email body as an ordered list of paragraphs.',
    },
    cta: { type: 'string', description: 'Call-to-action button label.' },
    seq: {
      type: 'array',
      description: 'A short follow-up sequence that sends on milestones.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          when: { type: 'string', description: 'Trigger, e.g. "Day 0", "On first session".' },
          title: { type: 'string' },
          open: { type: 'string', description: 'The opening line of that email.' },
        },
        required: ['when', 'title', 'open'],
      },
    },
  },
  required: ['subject', 'preheader', 'body', 'cta', 'seq'],
};

const LEGAL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    docTitle: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          h: { type: 'string', description: 'Section heading.' },
          p: { type: 'string', description: 'Section body (a real paragraph, not a placeholder).' },
        },
        required: ['h', 'p'],
      },
    },
    flag: {
      type: 'string',
      description: 'One-line reviewer note, e.g. that a lawyer should review before publishing.',
    },
  },
  required: ['docTitle', 'sections', 'flag'],
};

type Kind = 'text' | 'post' | 'email' | 'legal';

const KINDS: Record<Kind, { schema: Record<string, unknown> | null; instruction: string }> = {
  text: {
    schema: null,
    instruction: 'Write the deliverable as plain text.',
  },
  post: {
    schema: POST_SCHEMA,
    instruction:
      'Write exactly 3 distinct launch-post variants that take different angles on the same announcement.',
  },
  email: {
    schema: EMAIL_SCHEMA,
    instruction:
      'Write a launch/activation email: a subject, a preheader, 3-5 short body paragraphs, a CTA label, and a 2-3 step follow-up sequence.',
  },
  legal: {
    schema: LEGAL_SCHEMA,
    instruction:
      'Draft a real, formatted legal document with a clear title and 4-7 substantive sections written in plain language.',
  },
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

// Compose the user's persisted onboarding brief into company context so byte
// writes from their real company. Falls back to the baseline when absent.
function briefToContext(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const name = str(b.projectName, 120);
  const oneLiner = str(b.oneLiner, 240);
  const notes = str(b.notes, 800);
  const categories = Array.isArray(b.categories)
    ? b.categories.filter((c): c is string => typeof c === 'string').slice(0, 6)
    : [];
  const audience = str(b.audience, 160);
  const link = str(b.link, 200);
  if (!name && !oneLiner && !notes) return null;

  const parts: string[] = [`The company is ${name || "the founder's product"}.`];
  if (oneLiner) parts.push(oneLiner.endsWith('.') ? oneLiner : `${oneLiner}.`);
  if (categories.length) parts.push(`It is a ${categories.join(' / ').toLowerCase()} product.`);
  if (audience) parts.push(`It's for ${audience}.`);
  if (notes) parts.push(notes.endsWith('.') ? notes : `${notes}.`);
  if (link) parts.push(`Reference: ${link}.`);
  const who: string[] = [];
  const role = str(b.role, 80);
  const stage = str(b.stage, 80);
  if (role) who.push(`a ${role.toLowerCase()}`);
  if (stage) who.push(`at the ${stage.toLowerCase()} stage`);
  if (who.length) parts.push(`The founder is ${who.join(', ')}.`);
  const founderName = str(b.founderName, 80);
  if (founderName) parts.push(`Their name is ${founderName}.`);
  return parts.join(' ');
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
  try {
    await verifyIdToken(idToken);
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

  const context = briefToContext(body.brief) ?? CODEPET_CONTEXT;
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
