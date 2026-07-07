// The "this is the example, not your plan" signal for the Overview map. Codepet seeds a
// built-in example company (lib/data.ts) that shows until byte's scaffold generates a plan
// from the founder's real product. If generation hasn't run — or couldn't (e.g. the model
// was unreachable) — the seed stands, and it must never be mistaken for a tailored plan.
//
// Pure so the truth table is unit-tested: the banner shows for EXACTLY the states where the
// map is still the example, with copy that's honest about which state it is.

export interface ExamplePlanBanner {
  /** The honest one-liner shown on the map. */
  text: string;
  /** The action label — retry a failed generation, or kick off the first one. */
  cta: string;
}

/**
 * What (if anything) to show. Returns null once the plan is tailored (byte's scaffold
 * landed) — no banner. Otherwise the map is the example: if a scaffold attempt this session
 * failed, say so plainly; if it simply hasn't run yet, invite the founder to generate it.
 */
export function examplePlanBanner(opts: {
  planTailored: boolean;
  scaffoldFailed: boolean;
}): ExamplePlanBanner | null {
  if (opts.planTailored) return null;
  return opts.scaffoldFailed
    ? {
        text: 'byte couldn’t reach the model — this is an example company, not your plan yet.',
        cta: 'Retry',
      }
    : {
        text: 'Example company — byte hasn’t tailored this map to your product yet.',
        cta: 'Generate my plan',
      };
}
