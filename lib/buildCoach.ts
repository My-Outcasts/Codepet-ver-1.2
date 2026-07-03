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

/** Minimal shape the DURING bubble reads from the live doc. */
export interface DuringNarration {
  pendingAsk?: string;
  lastSay?: string;
}

/** Byte's DURING bubble line + mood, in priority order: a pending question wins
 *  (worried), else the latest narrated line (mood follows the budget), else null
 *  so the caller keeps its default copy. */
export function byteDuringLine(
  live: DuringNarration | null,
  warn: boolean,
): { say: string; mood: 'idle' | 'worried' } | null {
  if (live?.pendingAsk) return { say: live.pendingAsk, mood: 'worried' };
  if (live?.lastSay) return { say: live.lastSay, mood: warn ? 'worried' : 'idle' };
  return null;
}
