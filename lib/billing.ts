// Pure helpers for the Billing & Usage view and the Support modal.
import { creditCostForRoute } from './ai/credits';

/** The slice of a day's usage doc we read to compute credits: per-route call counts. */
export interface UsageDocData {
  route?: Record<string, { calls?: number } | undefined>;
}

/**
 * Total credits consumed across a set of daily usage docs — Σ over each doc, Σ over each
 * route key of (calls × its per-action credit cost). Credits can be fractional (chat is
 * priced at a fraction), so callers round for display. Non-numeric/negative call counts
 * are ignored so a bad counter value can't poison the total.
 */
export function creditsFromUsage(docs: readonly UsageDocData[]): number {
  let credits = 0;
  for (const d of docs) {
    const route = d.route ?? {};
    for (const key of Object.keys(route)) {
      const calls = route[key]?.calls;
      if (typeof calls === 'number' && Number.isFinite(calls) && calls > 0) {
        credits += calls * creditCostForRoute(key);
      }
    }
  }
  return credits;
}

/** Credit-balance meter for the Billing view (mirrors usageMeter, but credits not runs). */
export function creditMeter(
  used: number,
  allowance: number,
): { used: number; allowance: number; remaining: number; pct: number } {
  const safeAllowance = Number.isFinite(allowance) && allowance > 0 ? allowance : 0;
  const u = Number.isFinite(used) && used > 0 ? used : 0;
  const remaining = Math.max(0, safeAllowance - u);
  const pct = safeAllowance ? Math.max(0, Math.min(100, Math.round((u / safeAllowance) * 100))) : 0;
  return { used: u, allowance: safeAllowance, remaining, pct };
}

export function usageMeter(
  n: number,
  limit: number,
): { used: number; limit: number; pct: number; label: string } {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 0;
  const raw = Number.isFinite(n) && n > 0 ? n : 0;
  // `safeLimit` is 0 for an invalid limit, so Math.min clamps `used` to 0 there too.
  const used = Math.min(raw, safeLimit);
  const pct = safeLimit ? Math.max(0, Math.min(100, Math.round((used / safeLimit) * 100))) : 0;
  return { used, limit: safeLimit, pct, label: `${used} of ${safeLimit} runs` };
}

// The Support message is sendable only when it has real content.
export function canSendSupport(message: string): boolean {
  return message.trim().length > 0;
}
