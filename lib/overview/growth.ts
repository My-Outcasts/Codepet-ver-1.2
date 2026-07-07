// Detecting graph "growth": which departments just unlocked (dormant → active) when the
// company re-scaffolds on a stage advance / re-plan. Pure + node-env-Vitest-testable.
import type { Dept } from '../data';

export interface GrowthSignal {
  /** Department keys that unlocked (dormant before → active after) this re-scaffold. */
  unlockedKeys: string[];
  /** Distinct timestamp so a repeat unlock of the same keys still fires a reveal. */
  ts: number;
}

// Departments that were dormant before the re-scaffold and are active after.
export function unlockedKeys(beforeLater: Set<string>, deptsAfter: Dept[]): string[] {
  return deptsAfter.filter((d) => beforeLater.has(d.k) && !d.later).map((d) => d.k);
}
