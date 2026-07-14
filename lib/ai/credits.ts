// Pricing plan — per-action credit costs + plan allowances. Pure config + predicates,
// no Firestore/network, unit-testable in plain node (mirrors rateLimit.ts). This is the
// credit-accounting CORE only — it is NOT yet wired into the routes. Wiring it in (to
// replace the 30/day count guard in rateLimit.ts + serverUsage.ts) is the credit-engine
// integration, which also needs the plan-state model and Stripe overage billing. See the
// "Codepet pricing plan" + "Implementation roadmap" in Notion.
//
// Model: users spend CREDITS, a fixed amount per action (not per token) so spend is
// predictable. Costs are LOCKED (Jul 14) but calibrated from Opus 4.8 cost ratios
// (light ~$0.02, medium ~$0.045, heavy ~$0.08 ≈ 1:2:4) and chat's deliberately-cheap
// price — revisit the exact weights once Phase 0 replaces the estimates with real
// per-route token data.

/**
 * Credit cost of one metered AI action, by category. Chat is deliberately cheap (the
 * engagement loop); deliverables carry the real cost. Fractional costs are allowed.
 */
export const CREDIT_COSTS = {
  chat: 0.25, // cheap — the engagement loop; priced below its raw cost on purpose
  light: 1, // extraction / selection
  medium: 2, // structured multi-part generation
  heavy: 4, // full deliverables
} as const;

// Map each usage route key (the exact string passed to usageSink) to its credit cost.
// Keep in sync with the routeKeys the routes report; a key missing here falls back to
// `light` via creditCostForRoute (fail toward charging, never silently free).
const ROUTE_CREDITS: Readonly<Record<string, number>> = {
  chat: CREDIT_COSTS.chat,
  nextStep: CREDIT_COSTS.light,
  memory: CREDIT_COSTS.light,
  enrich: CREDIT_COSTS.light,
  enrichAnswer: CREDIT_COSTS.light,
  scaffold: CREDIT_COSTS.medium,
  runTask: CREDIT_COSTS.heavy,
  personalize: CREDIT_COSTS.heavy,
};

/**
 * Credits charged for one metered call on `routeKey`. Unknown keys fall back to the
 * light cost so a newly-added route can never be silently free (fail toward charging).
 */
export function creditCostForRoute(routeKey: string): number {
  return ROUTE_CREDITS[routeKey] ?? CREDIT_COSTS.light;
}

/** Pro plan's monthly included credit allowance (locked Jul 14). */
export const PRO_INCLUDED_CREDITS = 800;

/** Overage price once the Pro allowance is spent — USD per credit (locked Jul 14). */
export const OVERAGE_USD_PER_CREDIT = 0.05;

/** Trial allowance + length. Credit amount is PROVISIONAL — calibrate in Phase 0. */
export const TRIAL_INCLUDED_CREDITS = 150;
export const TRIAL_DAYS = 7;

/** Credits left in the included allowance (clamped at 0 — never negative). */
export function creditsRemaining(used: number, included: number): number {
  return Math.max(0, included - used);
}

/**
 * Trial is hard-stop: once the included allowance is spent, block further metered
 * actions (the user must upgrade). True means "block".
 */
export function overTrialAllowance(used: number, included: number): boolean {
  return used >= included;
}

/**
 * Pro bills overage instead of blocking — the credits spent beyond the allowance.
 * 0 while still within the included amount.
 */
export function overageCredits(used: number, included: number): number {
  return Math.max(0, used - included);
}

/** Dollar amount to bill for Pro overage this period. */
export function overageUsd(used: number, included: number): number {
  return overageCredits(used, included) * OVERAGE_USD_PER_CREDIT;
}
