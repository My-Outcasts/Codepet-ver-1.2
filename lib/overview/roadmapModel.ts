// The Overview roadmap, phase 1 — the normalized model.
//
// The roadmap renders a company-building JOURNEY as a branching dependency graph:
// phases left-to-right (columns), tasks stacked within a phase (rows), each tagged with a
// department, connected by dependency edges. This module owns the pure data contract; the
// layout engine (roadmapLayout.ts) turns it into positions, and RoadmapView renders it.
//
// Kept intentionally decoupled from lib/data.ts (DEPTS/PHASES/STAGE_TASKS): those don't yet
// tag a task with BOTH a phase and a department, so a `RoadmapTask` is the clean shape the
// canonical template (roadmapTemplate.ts) and, later, a real-data adapter both produce.

/** A task's state on the roadmap — mirrors taskState()'s vocabulary plus the single
 *  `current` move (byte's next step) which the map lights up and parks byte on. */
export type RoadmapState = 'done' | 'current' | 'available' | 'needsYou' | 'approve' | 'locked';

export interface RoadmapTask {
  /** Stable id (unique across the whole roadmap) — used for dependency edges. */
  id: string;
  /** Phase key this task belongs to (matches a RoadmapPhase.key). */
  phase: string;
  /** Department key (eng/mkt/ops/fin/legal/design/sales/support). */
  dept: string;
  title: string;
  state: RoadmapState;
  /** Who does the work once the task is unblocked: byte runs it autonomously (`byte` →
   *  "byte can do this") or it needs the founder (`you` → "Needs your input"). Defaults to
   *  `byte`. Determines whether an unblocked task reads as `available` or `needsYou`. */
  actor?: 'byte' | 'you';
  /** Ids of tasks that must complete before this one — draws the branches and gates
   *  available vs locked. Cross-phase edges are the norm; may be empty (a phase entry point). */
  dependsOn: string[];
}

/** A task's fixed structure, without its (progress-dependent) state. The canonical template
 *  is authored as these; `applyProgress` (roadmapProgress.ts) derives the `state` from the
 *  founder's real position to produce a `RoadmapTask`. */
export type RoadmapTaskDef = Omit<RoadmapTask, 'state'>;

export interface RoadmapPhase {
  key: string;
  name: string;
}

/** A dependency edge between two task ids, flagged if it lies on the critical path. */
export interface RoadmapEdge {
  from: string;
  to: string;
  critical: boolean;
}

/** The id of the single `current` task (byte's move), or null if none is current. */
export function currentTaskId(tasks: RoadmapTask[]): string | null {
  return tasks.find((t) => t.state === 'current')?.id ?? null;
}

/**
 * Edges from every task's `dependsOn`. An edge is CRITICAL when it touches the current
 * task — the incoming edge that led byte here and the outgoing edges to what this move
 * unblocks. Those are the ones the map lights up; everything else is a faint dependency.
 * Dangling deps (referencing an id not in `tasks`) are dropped, so a partial roadmap
 * still renders cleanly.
 */
export function deriveEdges(tasks: RoadmapTask[]): RoadmapEdge[] {
  const ids = new Set(tasks.map((t) => t.id));
  const current = currentTaskId(tasks);
  const edges: RoadmapEdge[] = [];
  for (const t of tasks) {
    for (const dep of t.dependsOn) {
      if (!ids.has(dep)) continue;
      edges.push({ from: dep, to: t.id, critical: t.id === current || dep === current });
    }
  }
  return edges;
}

/** Per-phase completion — the `n/m` counts shown in each column header. */
export function phaseProgress(
  phases: RoadmapPhase[],
  tasks: RoadmapTask[],
): Record<string, { done: number; total: number }> {
  const out: Record<string, { done: number; total: number }> = {};
  for (const p of phases) out[p.key] = { done: 0, total: 0 };
  for (const t of tasks) {
    const slot = out[t.phase];
    if (!slot) continue;
    slot.total += 1;
    if (t.state === 'done') slot.done += 1;
  }
  return out;
}
