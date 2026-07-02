// Stage model + progress grouping — the shared foundation for stage-aware setup
// and the Overview progress overlay. Reads the live DEPTS singleton, so the
// progress helpers must be called on each render (post-mutation), like roadmap.ts.
import { DEPTS, OB_STAGES } from './data';

/** The founder's product-stage ladder (from onboarding): Just an idea → Growing. */
export const STAGES = OB_STAGES;
export const STAGE_COUNT = OB_STAGES.length;

/** Match a persisted `brief.stage` label back to its 0-based index (-1 if unknown). */
export function stageIndexOf(stage?: string): number {
  if (!stage) return -1;
  const s = stage.trim().toLowerCase();
  return OB_STAGES.findIndex((x) => x.toLowerCase() === s);
}

export function stageLabelOf(index: number): string {
  return index >= 0 && index < OB_STAGES.length ? OB_STAGES[index] : '';
}

// Product = what you're building; Company = everything around it. Two halves the
// founder tracks separately in the progress overlay.
export const PRODUCT_DEPTS = new Set(['eng', 'design']);

export interface GroupProgress {
  done: number;
  total: number;
  pct: number;
}

function progressFor(inGroup: (k: string) => boolean): GroupProgress {
  let done = 0;
  let total = 0;
  for (const d of DEPTS) {
    if (!inGroup(d.k)) continue;
    for (const t of d.tasks) {
      total += 1;
      if (t.done) done += 1;
    }
  }
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

/** Progress across the Product departments (Engineering, Design). */
export function productProgress(): GroupProgress {
  return progressFor((k) => PRODUCT_DEPTS.has(k));
}

/** Progress across the Company departments (everything else). */
export function companyProgress(): GroupProgress {
  return progressFor((k) => !PRODUCT_DEPTS.has(k));
}
