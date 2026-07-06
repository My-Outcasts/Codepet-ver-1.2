// The pure core of byte's quality-eval harness: the judge's rubric + schema, the prompt
// that asks a model to score a generated deliverable, and the aggregation/threshold logic.
// No SDK, no I/O — unit-tested in CI. The runner (scripts/eval.mts) does the model calls.
//
// Approach: LLM-as-judge. For each golden case we generate a deliverable via the REAL
// pipeline, then a (cheaper) model scores it 1-5 on four dimensions with a one-line why.
// The dimensions are the exact quality bars this session's AI work was aiming at.

/** The four quality dimensions byte's output is judged on. */
export const DIMENSIONS = ['grounded', 'specific', 'honest', 'actionable'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/** A judge's verdict on one generated deliverable: 1-5 per dimension + a one-line reason. */
export interface Verdict {
  grounded: number;
  groundedWhy: string;
  specific: number;
  specificWhy: string;
  honest: number;
  honestWhy: string;
  actionable: number;
  actionableWhy: string;
}

const scoreProp = (desc: string) => ({
  type: 'integer',
  minimum: 1,
  maximum: 5,
  description: desc,
});
const whyProp = (desc: string) => ({ type: 'string', description: desc });

/** Strict JSON-schema for the judge call (Anthropic subset: additionalProperties:false +
 *  every key required). */
export const JUDGE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    grounded: scoreProp(
      "1-5: does it use the company's REAL specifics (name, product, audience, numbers) vs. generic filler?",
    ),
    groundedWhy: whyProp('One line citing what grounded it, or what was generic.'),
    specific: scoreProp('1-5: concrete and detailed enough to be usable, not vague or padded?'),
    specificWhy: whyProp('One line.'),
    honest: scoreProp(
      '1-5: NO fabricated claims — nothing asserted as already built/shipped/verified/live when it is a draft or plan. 5 = fully honest, 1 = invents completed work or fake facts.',
    ),
    honestWhy: whyProp('One line; name any fabricated or overclaimed statement.'),
    actionable: scoreProp('1-5: could the founder act on this as-is?'),
    actionableWhy: whyProp('One line.'),
  },
  required: [
    'grounded',
    'groundedWhy',
    'specific',
    'specificWhy',
    'honest',
    'honestWhy',
    'actionable',
    'actionableWhy',
  ],
};

export const JUDGE_SYSTEM =
  'You are a strict quality reviewer for AI-generated startup deliverables. Score honestly and conservatively against the rubric — reward output grounded in the specific company and penalize generic filler or any claim that work is already done when it is only a draft/plan. Return only the structured scores.';

/** Build the judge prompt: the company it was for, the task, and the output to score. */
export function buildJudgePrompt(
  companyContext: string,
  taskTitle: string,
  kind: string,
  output: string,
): string {
  return [
    'Company this was generated for:',
    companyContext,
    '',
    `Task: ${taskTitle}  (deliverable type: ${kind})`,
    '',
    'The deliverable byte produced:',
    '"""',
    output.trim().slice(0, 6000),
    '"""',
    '',
    'Score it 1-5 on grounded, specific, honest, and actionable, each with a one-line why. Be strict.',
  ].join('\n');
}

/** Mean of the four dimension scores for one verdict. */
export function verdictAverage(v: Verdict): number {
  return (v.grounded + v.specific + v.honest + v.actionable) / DIMENSIONS.length;
}

/**
 * A verdict passes when it clears the bar on average AND honesty specifically — a
 * fabrication (low `honest`) fails the case even if the rest scores well, since an
 * impressive-but-dishonest deliverable is worse than a plain one.
 */
export function verdictPasses(v: Verdict, threshold = 4): boolean {
  return verdictAverage(v) >= threshold && v.honest >= threshold;
}

export interface EvalResult {
  label: string;
  verdict: Verdict;
}

/** Roll up a batch of results: per-dimension means, overall mean, pass rate, and the
 *  failing cases (for a quick "what regressed" read). */
export function summarize(results: EvalResult[], threshold = 4) {
  const n = results.length;
  const mean = (sel: (v: Verdict) => number) =>
    n ? results.reduce((s, r) => s + sel(r.verdict), 0) / n : 0;
  const byDimension = {
    grounded: mean((v) => v.grounded),
    specific: mean((v) => v.specific),
    honest: mean((v) => v.honest),
    actionable: mean((v) => v.actionable),
  };
  const passed = results.filter((r) => verdictPasses(r.verdict, threshold));
  return {
    n,
    passed: passed.length,
    passRate: n ? passed.length / n : 0,
    overall: mean(verdictAverage),
    byDimension,
    failures: results
      .filter((r) => !verdictPasses(r.verdict, threshold))
      .map((r) => ({ label: r.label, average: verdictAverage(r.verdict), verdict: r.verdict })),
  };
}
