// Pure logic for the build-intake brainstorm: Byte reads the project scan + the
// conversation so far and asks ONE short, concrete follow-up question — or says
// it has enough to plan. The server route (app/api/build-intake) validates with
// sanitizeIntakeInput, prompts with intakePrompt, and constrains the reply to
// INTAKE_SCHEMA. Framework-free so all three are unit-tested without a network
// call. See docs/superpowers/specs/2026-07-08-build-intake-project-scan-design.md.

const MAX_CONTEXT = 1200;
const MAX_TURN = 400;
const MAX_TURNS = 12;

export interface IntakeInput {
  /** Prompt-ready project scan text ('' when none — hosted without a stored brief). */
  context: string;
  /** The founder's intake answers so far, oldest first. */
  turns: string[];
  project?: string;
}

export interface IntakeReply {
  /** Byte's next line — a short follow-up question, or a wrap-up when enough. */
  say: string;
  /** True when Byte has enough to plan (the UI nudges "Turn this into a plan"). */
  enough: boolean;
}

/** Validate + bound the request body. Null when there are no turns yet. */
export function sanitizeIntakeInput(body: unknown): IntakeInput | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const turns = Array.isArray(b.turns)
    ? b.turns
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim().slice(0, MAX_TURN))
        .slice(-MAX_TURNS)
    : [];
  if (turns.length === 0) return null;
  const context = typeof b.context === 'string' ? b.context.trim().slice(0, MAX_CONTEXT) : '';
  const project = typeof b.project === 'string' ? b.project.trim().slice(0, 128) : '';
  return project ? { context, turns, project } : { context, turns };
}

/** Compose the brainstorm prompt from the scan + the conversation so far. */
export function intakePrompt({ context, turns, project }: IntakeInput): string {
  return [
    'A founder (a non-technical "vibe-coder") is describing something they want to',
    'build with an AI coding agent inside their existing project. Your job: ask the',
    'ONE next follow-up question that most sharpens the build — grounded in what',
    'the project actually contains — or say you have enough to plan.',
    '',
    project ? `Project: ${project}` : null,
    context ? `What a quick scan of the project shows:\n${context}` : null,
    '',
    "The founder's answers so far, oldest first:",
    ...turns.map((t, i) => `${i + 1}. ${t}`),
    '',
    'Rules: ONE short question (a single sentence, plain words, no jargon), and',
    'prefer questions the scan makes concrete (e.g. reuse an existing dependency,',
    'which folder/screen it belongs to, how it fits what the app already does).',
    'If you already know who it is for, what "done" looks like, and roughly where',
    'it fits, set enough=true and make `say` a short confident wrap-up instead',
    '(e.g. "Got it — I can plan this now!"). Never ask more than one thing.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

// Strict JSON-schema subset: additionalProperties:false + every property required.
export const INTAKE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    say: {
      type: 'string',
      description:
        "Byte's next line: ONE short follow-up question, or a short wrap-up when enough=true. Warm, plain words.",
    },
    enough: {
      type: 'boolean',
      description: 'True when there is enough to generate a build plan.',
    },
  },
  required: ['say', 'enough'],
};
