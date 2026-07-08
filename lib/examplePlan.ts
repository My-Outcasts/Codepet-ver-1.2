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
 * failed, name the actual cause; if it simply hasn't run yet, invite the founder to generate it.
 */
export function examplePlanBanner(opts: {
  planTailored: boolean;
  scaffoldFailure: string | null;
}): ExamplePlanBanner | null {
  if (opts.planTailored) return null;
  if (!opts.scaffoldFailure) {
    return {
      text: 'Example company — byte hasn’t tailored this map to your product yet.',
      cta: 'Generate my plan',
    };
  }
  const text =
    opts.scaffoldFailure === 'refused'
      ? 'byte couldn’t tailor this one — try again. This is still an example, not your plan.'
      : opts.scaffoldFailure === 'incomplete'
        ? 'byte couldn’t finish tailoring your map — try again. This is still an example, not your plan.'
        : opts.scaffoldFailure === 'rate_limited'
          ? 'You’ve hit today’s limit — it resets tomorrow. This is still an example, not your plan.'
          : 'byte couldn’t reach the model — this is an example company, not your plan yet.';
  return { text, cta: 'Retry' };
}
