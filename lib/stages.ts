// Stage model + progress grouping — the shared foundation for stage-aware setup
// and the Overview progress overlay. Reads the live DEPTS singleton, so the
// progress helpers must be called on each render (post-mutation), like roadmap.ts.
import { DEPTS, OB_STAGES, PHASES } from './data';

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

/** The next rung on the founder's product ladder, or null at the top (Growing) / unknown. */
export function nextStageOf(stage?: string): string | null {
  const i = stageIndexOf(stage);
  if (i < 0 || i >= OB_STAGES.length - 1) return null;
  return OB_STAGES[i + 1];
}

/**
 * True when the founder has finished the work for their current stage: every active
 * (non-dormant) department's tasks are done. Dormant "later" departments are excluded
 * — they belong to future stages. Requires at least one active task so an empty/loading
 * company never reads as "complete". Reads the live DEPTS singleton — call per render.
 */
export function stageComplete(): boolean {
  let total = 0;
  let done = 0;
  for (const d of DEPTS) {
    if (d.later) continue;
    for (const t of d.tasks) {
      total += 1;
      if (t.done) done += 1;
    }
  }
  return total > 0 && done === total;
}

// Map each onboarding stage to the roadmap stage that is "now" on the Find → Build →
// Ship → Launch → Grow spine (stages 1-9 in PHASES). Everything before is done, this
// one is where they are, everything after is up next. Index matches OB_STAGES order.
const STAGE_TO_ROADMAP = [1, 3, 6, 7, 8, 9];
const DEFAULT_WATERMARK = 6; // private-beta scenario — matches the legacy seed

/** The roadmap "you are here" stage number for a persisted brief.stage. */
export function roadmapWatermarkFor(stage?: string): number {
  const i = stageIndexOf(stage);
  return i >= 0 && i < STAGE_TO_ROADMAP.length ? STAGE_TO_ROADMAP[i] : DEFAULT_WATERMARK;
}

/** The roadmap phase name containing a watermark stage (e.g. 6 → "Launch"). */
export function phaseNameForWatermark(watermark: number): string {
  for (const p of PHASES) {
    if (p.stages.some((s) => s.n === watermark)) return p.name;
  }
  return '';
}

/** The roadmap phase name the founder is currently in, from their brief.stage. */
export function currentPhaseName(stage?: string): string {
  return phaseNameForWatermark(roadmapWatermarkFor(stage));
}

/** The roadmap phase after the founder's current one (matches the breadcrumb), or null
 *  when they're already in the last phase. Keeps the progress hero's "next milestone"
 *  consistent with the phase breadcrumb (unlike nextStageOf, which uses the finer
 *  onboarding-stage list and runs out first). */
export function nextPhaseName(stage?: string): string | null {
  const cur = currentPhaseName(stage);
  const i = PHASES.findIndex((p) => p.name === cur);
  return i >= 0 && i < PHASES.length - 1 ? PHASES[i + 1].name : null;
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

/**
 * How far through the current stage: the done-fraction of active (non-`later`)
 * department tasks — the same universe `stageComplete()` measures, so `pct === 100`
 * iff `stageComplete()` (when there is at least one active task). Reads the live
 * DEPTS singleton — call per render.
 */
export function currentStageProgress(): GroupProgress {
  let done = 0;
  let total = 0;
  for (const d of DEPTS) {
    if (d.later) continue;
    for (const t of d.tasks) {
      total += 1;
      if (t.done) done += 1;
    }
  }
  // Guard the 100%-iff-complete invariant: Math.round(99.5) would otherwise
  // read 100% at >~200 tasks while a task is still open.
  const pct =
    total === 0 ? 0 : done === total ? 100 : Math.min(99, Math.round((done / total) * 100));
  return { done, total, pct };
}
