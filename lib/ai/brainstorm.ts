// Pure, framework-free logic for Byte's brainstorm step at "Let's build". The
// server route (app/api/build-brainstorm) validates input with
// sanitizeBrainstormInput, prompts Claude with buildBrainstormPrompt, and
// constrains the reply to BRAINSTORM_SCHEMA. Kept here so validation + prompt
// shaping are unit-tested without a network call. Mirrors lib/ai/plan.ts. See
// docs/superpowers/specs/2026-07-14-byte-brainstorm-lets-build-design.md.

const MAX_FIELD = 400;
const MAX_TURNS = 12;

/** One line of the intake conversation Byte reasons over. */
export interface BrainstormTurn {
  role: 'byte' | 'user';
  text: string;
}

/** Request body for /api/build-brainstorm. */
export interface BrainstormInput {
  conversation: BrainstormTurn[];
  project?: string;
}

/** Byte's next move: ask one more question, or reflect back and offer to build. */
export interface BrainstormReply {
  kind: 'question' | 'ready';
  text: string;
}

/** Validate + normalize the request body. Returns null unless the conversation
 *  is an array with at least one non-blank founder ("user") turn. Malformed
 *  turns are dropped; text is trimmed/capped; only the most recent turns kept. */
export function sanitizeBrainstormInput(body: unknown): BrainstormInput | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.conversation)) return null;

  const conversation: BrainstormTurn[] = [];
  for (const raw of b.conversation) {
    if (!raw || typeof raw !== 'object') continue;
    const t = raw as Record<string, unknown>;
    const role = t.role === 'byte' || t.role === 'user' ? t.role : null;
    const text = typeof t.text === 'string' ? t.text.trim().slice(0, MAX_FIELD) : '';
    if (!role || !text) continue;
    conversation.push({ role, text });
  }

  const trimmed = conversation.slice(-MAX_TURNS);
  if (!trimmed.some((t) => t.role === 'user')) return null;

  const project = typeof b.project === 'string' ? b.project.trim().slice(0, MAX_FIELD) : '';
  return project ? { conversation: trimmed, project } : { conversation: trimmed };
}

/** Compose the user prompt: the transcript + how many questions Byte has asked
 *  + the ask-one-or-reflect-back instruction. */
export function buildBrainstormPrompt({ conversation, project }: BrainstormInput): string {
  const asked = conversation.filter((t) => t.role === 'byte').length;
  const transcript = conversation
    .map((t) => `${t.role === 'byte' ? 'Byte' : 'Founder'}: ${t.text}`)
    .join('\n');
  return [
    'You are brainstorming a build with a vibe-coder before writing a plan.',
    'Understand what they want by asking short, targeted questions — one at a',
    'time — then reflect it back for them to confirm.',
    '',
    project ? `Project area: ${project}` : null,
    'Conversation so far:',
    transcript,
    '',
    `You have already asked ${asked} question(s).`,
    'Decide ONE of:',
    '- kind:"question" — ask exactly ONE short question that fills the biggest',
    "  remaining gap among: who it's for, the core problem, scope/must-haves, and",
    '  what "done" looks like. Never re-ask something already answered.',
    '- kind:"ready" — if you already have enough, OR you have asked 3 questions,',
    "  reflect back what you will build in 1-2 warm sentences (\"Here's what I'll",
    '  build: ..."). Do not ask another question.',
    '',
    'Keep it token-thrifty. Reply only with the requested JSON.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

// Strict JSON-schema subset: additionalProperties:false + every property required.
export const BRAINSTORM_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: {
      type: 'string',
      enum: ['question', 'ready'],
      description: 'question = ask one more; ready = reflect back and offer to build.',
    },
    text: {
      type: 'string',
      description: 'The single next question, or the 1-2 sentence reflect-back summary.',
    },
  },
  required: ['kind', 'text'],
};
