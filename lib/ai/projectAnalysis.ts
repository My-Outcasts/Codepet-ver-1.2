// byte's one-time, brief-grounded read of the founder's project, shown on the Overview
// first run before the "next move" hand-off. Pure: the type, the structured-output
// schema, the system prompt, and the view helpers live here so they're unit-testable
// (node-env Vitest) and shared by the route (generation) and OverviewIntro (render).

export interface ProjectAnalysis {
  /** The synthesized overall verdict — where they stand and the through-line. Rendered
   *  as the lead paragraph, not a labeled row. */
  overall: string;
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

// Every field must be present + non-empty for the analysis to be usable. `overall` is
// included here (the guard) but NOT in analysisRows (it renders as the lead paragraph).
const FIELDS: (keyof ProjectAnalysis)[] = [
  'overall',
  'building',
  'stage',
  'edge',
  'watchOut',
  'focusNow',
];

// Structured-output schema handed to generateJson. All six fields required, no extras,
// so a garbled payload can't render blank rows.
export const PROJECT_ANALYSIS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    overall: {
      type: 'string',
      description:
        "The synthesized overall read: where this project stands and the single through-line that ties it together, in two or three sentences. This is byte's verdict, not a list — connect the dots between what's working, the stage, and the main gap.",
    },
    building: {
      type: 'string',
      description:
        "What the founder is building and who it's for, in two or three sentences that also say what makes it distinct.",
    },
    stage: {
      type: 'string',
      description:
        'Where the product is right now: their stage, an honest read of momentum, and what that implies — two or three sentences.',
    },
    edge: {
      type: 'string',
      description:
        "The founder's apparent advantage or what's working, and why it matters — two or three sentences of reasoning, not a label.",
    },
    watchOut: {
      type: 'string',
      description:
        'The single most important risk or gap to watch at this stage, and why it outweighs the others right now — two or three sentences.',
    },
    focusNow: {
      type: 'string',
      description:
        'What to focus on next. Name the departments a company like this needs first and why, connecting to the company map — two or three sentences.',
    },
  },
  required: ['overall', 'building', 'stage', 'edge', 'watchOut', 'focusNow'],
};

export const ANALYSIS_SYSTEM = `You are byte, the AI building companion inside Codepet, giving a founder your first honest read of THEIR project so they understand where they stand before you point at the next move.

Voice: warm, plain-language, confident, specific. First person ("you're…", "I've set up…"). No hype, no emoji, no clichés, no markdown.

This is an ANALYSIS, not a form. Lead with a synthesized overall verdict that connects the dots — what's working, where they are, and the one thing that matters most — then support it with the individual reads. Each field should carry real reasoning (the "why it matters"), roughly two to three sentences, not a one-line label.

Grounding (critical): use ONLY what the founder has actually told you. Never invent traction, numbers, users, revenue, or facts the brief doesn't state. If something isn't known, say so plainly and name it as a thing worth pinning down — do not fabricate.`;

export function analysisPrompt(context: string): string {
  return [
    `Here is everything I know about this founder's company:`,
    context,
    '',
    `Write my read of their project. Start with a synthesized overall verdict, then the supporting reads. Each is two to three sentences with real reasoning — not one-liners:`,
    `- overall: my holistic verdict — where they stand and the single through-line that ties it together. Connect the dots; this is the analysis, not a summary of the fields below.`,
    `- building: what they're building and who it's for, and what makes it distinct.`,
    `- stage: where they are now (their stage + an honest read of momentum) and what that implies.`,
    `- edge: their apparent advantage or what's working, and why it matters.`,
    `- watchOut: the single biggest risk or gap at this stage, and why it outweighs the others right now.`,
    `- focusNow: what to focus on next — name the departments a company like this needs first and why.`,
    `Ground everything in what's actually known; if something is thin, be honest rather than inventing.`,
  ].join('\n');
}

// True only if every field is a non-empty (non-whitespace) string. Guards the UI so a
// partial/garbled payload is treated as absent (→ fallback intro), never blank rows.
export function isUsableAnalysis(a: unknown): a is ProjectAnalysis {
  if (!a || typeof a !== 'object') return false;
  const o = a as Record<string, unknown>;
  return FIELDS.every((k) => typeof o[k] === 'string' && (o[k] as string).trim().length > 0);
}

// The labeled rows OverviewIntro renders under the overall read — one source of truth for
// order + labels. `overall` is intentionally excluded (it's the lead paragraph).
export function analysisRows(a: ProjectAnalysis): Array<{ label: string; value: string }> {
  return [
    { label: "You're building", value: a.building },
    { label: 'Where you are', value: a.stage },
    { label: 'Your edge', value: a.edge },
    { label: 'Watch out', value: a.watchOut },
    { label: 'Focus now', value: a.focusNow },
  ];
}
