// byte's one-time, brief-grounded read of the founder's project, shown on the Overview
// first run before the "next move" hand-off. Pure: the type, the structured-output
// schema, the system prompt, and the view helpers live here so they're unit-testable
// (node-env Vitest) and shared by the route (generation) and OverviewIntro (render).

export interface ProjectAnalysis {
  /** What they're building and who it's for. */
  building: string;
  /** Where they are right now (stage + honest read of momentum). */
  stage: string;
  /** Their apparent advantage / what's working. */
  edge: string;
  /** The main risk or gap to watch at this stage. */
  watchOut: string;
  /** What to focus on next — names the departments byte set up and why. */
  focusNow: string;
}

const FIELDS: (keyof ProjectAnalysis)[] = ['building', 'stage', 'edge', 'watchOut', 'focusNow'];

// Structured-output schema handed to generateJson. All five fields required, no extras,
// so a garbled payload can't render blank rows.
export const PROJECT_ANALYSIS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    building: {
      type: 'string',
      description: "What the founder is building and who it's for, in one or two sentences.",
    },
    stage: {
      type: 'string',
      description: 'Where the product is right now: their stage plus an honest read of momentum.',
    },
    edge: { type: 'string', description: "The founder's apparent advantage or what's working." },
    watchOut: {
      type: 'string',
      description: 'The single most important risk or gap to watch at this stage.',
    },
    focusNow: {
      type: 'string',
      description:
        'What to focus on next. Name the departments a company like this needs first and why, so it connects to the company map.',
    },
  },
  required: ['building', 'stage', 'edge', 'watchOut', 'focusNow'],
};

export const ANALYSIS_SYSTEM = `You are byte, the AI building companion inside Codepet, giving a founder your first honest read of THEIR project so they understand where they stand before you point at the next move.

Voice: warm, plain-language, confident, specific. First person ("you're…", "I've set up…"). No hype, no emoji, no clichés, no markdown.

Grounding (critical): use ONLY what the founder has actually told you. Never invent traction, numbers, users, revenue, or facts the brief doesn't state. If something isn't known, say so plainly and name it as a thing worth pinning down — do not fabricate. Keep every field to one or two tight sentences.`;

export function analysisPrompt(context: string): string {
  return [
    `Here is everything I know about this founder's company:`,
    context,
    '',
    `Write my read of their project as five short fields:`,
    `- building: what they're building and who it's for.`,
    `- stage: where they are now (their stage + an honest read of momentum).`,
    `- edge: their apparent advantage or what's working.`,
    `- watchOut: the single biggest risk or gap to watch at this stage.`,
    `- focusNow: what to focus on next — name the departments a company like this needs first and why.`,
    `Ground every field in what's actually known; if a field is thin, be honest rather than inventing.`,
  ].join('\n');
}

// True only if every field is a non-empty (non-whitespace) string. Guards the UI so a
// partial/garbled payload is treated as absent (→ fallback intro), never blank rows.
export function isUsableAnalysis(a: unknown): a is ProjectAnalysis {
  if (!a || typeof a !== 'object') return false;
  const o = a as Record<string, unknown>;
  return FIELDS.every((k) => typeof o[k] === 'string' && (o[k] as string).trim().length > 0);
}

// The labeled rows OverviewIntro renders — one source of truth for order + labels.
export function analysisRows(a: ProjectAnalysis): Array<{ label: string; value: string }> {
  return [
    { label: "You're building", value: a.building },
    { label: 'Where you are', value: a.stage },
    { label: 'Your edge', value: a.edge },
    { label: 'Watch out', value: a.watchOut },
    { label: 'Focus now', value: a.focusNow },
  ];
}
