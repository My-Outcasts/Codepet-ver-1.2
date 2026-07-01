// Phase 6.4 — per-user daily cost guard for the paid AI routes.
//
// Pure config + predicates, kept out of the route (no Firestore/network) so they're
// unit-testable in plain node. The Firestore counter I/O lives in
// lib/firebase/serverUsage.ts; the route wires the two together.

/** Generations allowed per user per UTC day when AI_DAILY_LIMIT is unset. */
export const DEFAULT_DAILY_LIMIT = 30;

/**
 * Resolve the daily cap from the AI_DAILY_LIMIT env var, falling back to the
 * default. Ignores anything that isn't a positive integer so a typo can never
 * silently disable the guard (0/NaN/negative → default, not "unlimited").
 */
export function resolveDailyLimit(raw: string | number | undefined | null): number {
  const n = typeof raw === 'string' ? Number(raw.trim()) : typeof raw === 'number' ? raw : NaN;
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_DAILY_LIMIT;
}

/** UTC day bucket key, e.g. "2026-07-01" — the id of the per-day usage doc. */
export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** True once the day's running count has passed the cap (cap generations allowed). */
export function overDailyLimit(count: number, cap: number): boolean {
  return count > cap;
}
