// Pure logic for the Build Coach view's DURING step. Kept framework-free so the
// budget → Byte-mood mapping is unit-tested independently of React.
// See docs/superpowers/specs/2026-07-02-build-coach-view-design.md.

/** At/above this budget-spent percentage, Byte gets worried and the
 *  "Double-check" habit unlocks. */
export const DANGER_PCT = 80;

export interface BudgetState {
  /** Short status shown next to the meter, e.g. "on track 😌" / "worried! 😰". */
  label: string;
  mood: 'ok' | 'worried';
  /** True at/above the danger threshold — drives the amber meter + shake. */
  warn: boolean;
  /** Whether this reading should unlock the "Double-check" habit. */
  unlock: boolean;
}

/** Derive Byte's DURING-step reaction from the budget slider (0–100 % spent). */
export function budgetState(pct: number): BudgetState {
  const warn = pct >= DANGER_PCT;
  return {
    label: warn ? 'worried! 😰' : 'on track 😌',
    mood: warn ? 'worried' : 'ok',
    warn,
    unlock: warn,
  };
}
