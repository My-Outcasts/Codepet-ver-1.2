// Roadmap stage logic — ported from the draft. These read the live `done`
// state off DEPTS, so they must be called on each render (post-mutation).
import { DEPTS, STAGE_TASKS, NODES, type Dept, type Task } from './data';

export interface StageTaskRef {
  dept: Dept;
  task: Task;
}

export function stageTasks(num: number): StageTaskRef[] {
  return (STAGE_TASKS[num] || [])
    .map(([k, t]) => {
      const d = DEPTS.find((x) => x.k === k);
      const task = d && d.tasks.find((x) => x.t === t);
      return task && d ? { dept: d, task } : null;
    })
    .filter((x): x is StageTaskRef => Boolean(x));
}

export function stageProgress(num: number): { done: number; total: number } {
  const ts = stageTasks(num);
  return { done: ts.filter((x) => x.task.done).length, total: ts.length };
}

// The founder's position on the journey: the roadmap stage number that is "now",
// derived from their onboarding stage (see roadmapWatermarkFor). Mutated on hydrate
// so the whole roadmap reflects where they actually are, instead of a hardcoded
// private-beta scenario. Default = 6 (the legacy seed) until a brief loads.
let watermark = 6;
export function setStageWatermark(n: number): void {
  if (typeof n === 'number' && n > 0) watermark = n;
}
export function stageWatermark(): number {
  return watermark;
}

// A stage is done when it sits BEFORE the founder's current position. Purely
// position-based now (task-completion-based "progression" is a separate, later
// feature) — and it no longer depends on STAGE_TASKS, which the stage scaffold
// rewrites out from under it.
export function isStageDone(s: any): boolean {
  return typeof s?.n === 'number' && s.n < watermark;
}

// Effective state of a node, purely by position on the journey: stages before the
// founder's current one are done, their current one is now, everything ahead is up
// next. (No dependency-chain "locked" — the roadmap is a where-am-I map, and a scaffold
// re-plan can move the watermark, so a friendly "up next" reads better than a wall of
// locks. Kept in the return type for callers that still branch on it.)
export function eff(n: any): 'done' | 'locked' | 'now' | 'next' {
  if (typeof n?.n !== 'number') return 'next';
  if (n.n < watermark) return 'done';
  if (n.n === watermark) return 'now';
  return 'next';
}

// The authored golden-path "next step": the single task to do next, from the
// current stage. This is the deterministic FALLBACK the beacon and byte both read
// when byte's own ranking (/api/next-step) hasn't resolved or is unavailable — so
// the two surfaces always agree even offline. Reads live DEPTS, so call per render.
export function nextAction(): StageTaskRef | null {
  const now = NODES.find((n) => eff(n) === 'now');
  if (!now) return null;
  const refs = stageTasks(now.n);
  const open = refs.filter((r) => !r.task.done);
  // what needs the founder first, then anything still in flight
  return (
    open.find((r) => r.task.who === 'you') ||
    open.find((r) => r.task.who === 'draft') ||
    open[0] ||
    refs[refs.length - 1] ||
    null
  );
}
