// Pure, framework-free logic for the Build Coach's "generate a plan" step. The
// server route (app/api/build-plan) validates input with sanitizePlanInput,
// prompts Claude with buildPlanPrompt, and constrains the reply to PLAN_SCHEMA.
// Kept here so the validation + prompt shaping are unit-tested without a network
// call. See docs/superpowers/specs/2026-07-02-build-coach-view-design.md.

const MAX_FIELD = 400;
const MAX_CONTEXT = 1200;

export interface PlanInput {
  /** Free-text description of what the user wants to build — anything they type. */
  brief: string;
  /** Optional project area the build belongs to (e.g. a department name). */
  project?: string;
  /** Optional project-scan text (stack, deps, folders) so steps match the real
   *  codebase. See the 2026-07-08 intake design. */
  context?: string;
}

/** The plan Byte returns for the START step. */
export interface BytePlan {
  title: string;
  budgetK: number;
  /** Expected number of agent actions (tool-uses) the plan should take — the
   *  DURING "piggy bank" fills toward this. */
  budgetActions: number;
  steps: string[];
  /** 0-based indices of steps Byte is genuinely unsure about (assumptions/guesses),
   *  so the plan card can flag them for the founder to confirm. Empty when confident. */
  uncertain?: number[];
}

/** Validate + normalize the request body. Returns null when the brief is
 *  missing or blank (the route answers 400). Each field is trimmed and capped. */
export function sanitizePlanInput(body: unknown): PlanInput | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const brief = typeof b.brief === 'string' ? b.brief.trim().slice(0, MAX_FIELD) : '';
  if (!brief) return null;
  const project = typeof b.project === 'string' ? b.project.trim().slice(0, MAX_FIELD) : '';
  const context = typeof b.context === 'string' ? b.context.trim().slice(0, MAX_CONTEXT) : '';
  const out: PlanInput = { brief };
  if (project) out.project = project;
  if (context) out.context = context;
  return out;
}

/** Compose the user prompt from the free-text brief. */
export function buildPlanPrompt({ brief, project, context }: PlanInput): string {
  return [
    'A vibe-coder is about to build a feature with an AI coding agent. Turn their',
    'intent into a small, token-thrifty build plan they can follow.',
    '',
    project ? `Project area: ${project}` : null,
    context ? `What a quick scan of the project shows:\n${context}` : null,
    `What they want to build: ${brief}`,
    '',
    context
      ? 'Ground the steps in what the scan shows — reuse existing dependencies and folders instead of inventing new ones.'
      : null,
    'Return a plan with 3-5 concrete, ordered steps (each a short imperative line),',
    'a suggested token budget in thousands (budgetK, between 100 and 800), an',
    'expected number of agent actions/tool-uses (budgetActions, an integer between 5',
    "and 40), and a short encouraging title in Byte's warm voice. The last step",
    'should always be to double-check the work before calling it done.',
    'Also return `uncertain`: the 0-based indices of any steps you are genuinely',
    'guessing at or where you assumed something about their intent (empty array if',
    'you are confident about every step).',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

// Strict JSON-schema subset: additionalProperties:false + every property required.
export const PLAN_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: {
      type: 'string',
      description: 'Short, warm, encouraging title in Byte\'s voice, e.g. "Byte\'s got it!".',
    },
    budgetK: {
      type: 'integer',
      description: 'Suggested token budget in thousands (100-800).',
    },
    budgetActions: {
      type: 'integer',
      description: 'Expected number of agent actions/tool-uses (5-40).',
    },
    steps: {
      type: 'array',
      items: { type: 'string' },
      description: '3-5 concrete, ordered build steps; the last one double-checks the work.',
    },
    uncertain: {
      type: 'array',
      items: { type: 'integer' },
      description:
        '0-based indices of steps you are genuinely unsure about (guesses/assumptions); empty if confident.',
    },
  },
  required: ['title', 'budgetK', 'budgetActions', 'steps', 'uncertain'],
};
