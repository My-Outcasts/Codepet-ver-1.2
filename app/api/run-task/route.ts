// Phase 3 — byte's task loop, made real. This server route calls the Claude API
// to generate a deliverable from the user's company context + the task. The
// ANTHROPIC_API_KEY stays server-side (never NEXT_PUBLIC). Node runtime so the
// official SDK runs.
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';

// byte's voice + output contract.
const BYTE_SYSTEM = `You are byte, the AI building companion inside Codepet. You produce real, ready-to-use deliverables for a founder building their company with AI — not descriptions of deliverables.

Voice: warm, plain-language, confident, specific. No hype, no emoji, no clichés.

Output ONLY the deliverable itself. No preamble, no "Here is", no meta-commentary, no surrounding markdown code fences, no sign-off about being an AI. Write the thing the founder will actually use.`;

// Baseline company context. Phase 4 will swap this for the user's real business
// brief once onboarding persists it; until then byte writes from the product.
const CODEPET_CONTEXT = `Codepet is a macOS companion that builds your whole company with you, department by department. It reads your project, writes the business brief and roadmap, then does real work across Engineering, Marketing, Design, Finance, Operations, Legal, Sales, and Support — producing real deliverables you approve. The promise is comprehension plus control: a real company, and one you actually understand.`;

interface RunTaskBody {
  taskTitle?: unknown;
  taskHint?: unknown;
  deptName?: unknown;
}

function buildPrompt({
  taskTitle,
  taskHint,
  deptName,
}: {
  taskTitle: string;
  taskHint?: string;
  deptName?: string;
}): string {
  const lines = [
    `Company context: ${CODEPET_CONTEXT}`,
    '',
    deptName ? `Department: ${deptName}` : null,
    `Task: ${taskTitle}`,
    taskHint ? `Intended deliverable (for format/length guidance): ${taskHint}` : null,
    '',
    'Write the deliverable now.',
  ].filter(Boolean);
  return lines.join('\n');
}

export async function POST(req: Request): Promise<Response> {
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

  const taskTitle = typeof body.taskTitle === 'string' ? body.taskTitle.trim() : '';
  if (!taskTitle) {
    return Response.json(
      { error: 'bad_request', message: 'taskTitle is required.' },
      { status: 400 },
    );
  }
  const taskHint = typeof body.taskHint === 'string' ? body.taskHint.slice(0, 400) : undefined;
  const deptName = typeof body.deptName === 'string' ? body.deptName : undefined;

  const client = new Anthropic({ apiKey });
  try {
    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' }, // short deliverables — keep it snappy
      system: BYTE_SYSTEM,
      messages: [{ role: 'user', content: buildPrompt({ taskTitle, taskHint, deptName }) }],
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
    return Response.json({ text });
  } catch (err) {
    console.error('[run-task] generation failed', err);
    const status = err instanceof Anthropic.APIError ? (err.status ?? 502) : 502;
    return Response.json({ error: 'generation_failed' }, { status });
  }
}
