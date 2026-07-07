// Progress math for the Overview dashboard. Pure + node-env-Vitest-testable. The ONE
// source the per-department ring (node build) and the overall hero both read, so they
// can never disagree. Mirrors the non-dormant universe stages.ts uses.
import type { Dept } from '../data';

export interface Progress {
  done: number;
  total: number;
  pct: number;
}

// One department's task completion.
export function deptProgress(dept: Dept): Progress {
  const total = dept.tasks.length;
  const done = dept.tasks.filter((t) => t.done).length;
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}

export interface OverviewProgress extends Progress {
  /** Active (non-dormant) departments that are 100% complete. */
  areasDone: number;
  /** Total active (non-dormant) departments. */
  areasTotal: number;
}

// Whole active-plan rollup for the hero. Excludes dormant (`later`) departments.
export function overviewProgress(depts: Dept[]): OverviewProgress {
  let done = 0;
  let total = 0;
  let areasDone = 0;
  let areasTotal = 0;
  for (const d of depts) {
    if (d.later) continue;
    areasTotal += 1;
    const p = deptProgress(d);
    done += p.done;
    total += p.total;
    if (p.total > 0 && p.done === p.total) areasDone += 1;
  }
  // Guard: never read 100% with a task still open (matches currentStageProgress).
  const pct =
    total === 0 ? 0 : done === total ? 100 : Math.min(99, Math.round((done / total) * 100));
  return { done, total, pct, areasDone, areasTotal };
}
