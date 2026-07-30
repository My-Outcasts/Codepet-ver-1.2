// THE single roadmap projection.
//
// Every surface that talks about "where the founder is" and "what's next" — the Overview beacon
// and lit map node (OverviewSection), the chat's next-step grounding, the first-run greeting, and
// the after-completion nudge (all via the store) — derives from THIS one function. So they can
// never disagree about the current phase, the next move, which department owns it, or how far
// along the founder is. It composes the tested pure primitives in roadmapProgress.ts into one
// canonical assembly; it does NOT introduce new derivation logic of its own.
//
// Pure and unit-tested (roadmapSelector.test.ts asserts the cross-surface invariants).
import { ROADMAP_PHASES } from './roadmapTemplate';
import type { RoadmapState, RoadmapTask, RoadmapTaskDef } from './roadmapModel';
import { applyProgress, effectivePhase, roadmapOverrides } from './roadmapProgress';

/** The single agreed next move, enriched with the node's canonical department + actor so every
 *  surface names it identically. `null` when nothing in the phase is actionable (e.g. the final
 *  phase is complete). */
export interface RoadmapMove {
  deptK: string;
  title: string;
  id: string;
  actor: 'byte' | 'you';
}

export interface RoadmapSelection {
  /** The founder's effective phase key (declared stage, advanced past completed phases). */
  phase: string;
  /** Display name of the effective phase. */
  phaseName: string;
  /** Display name of the next phase — the "next milestone". */
  nextMilestone: string;
  /** THE next move — the beacon, chat, greeting, and nudge all read this. */
  move: RoadmapMove | null;
  /** Every task with its derived state; `move` (or, if none, the phase's first task) is lit as
   *  `current` so the map always has a focal node. */
  tasks: RoadmapTask[];
  /** Journey progress from the roadmap itself. */
  progress: { done: number; total: number; pct: number };
}

/** The minimal department shape the selector reads — a structural subset of DEPTS. */
export interface DeptLike {
  k: string;
  tasks: { t: string; done?: boolean; drafted?: boolean; roadmapNodeId?: string }[];
}

/**
 * Project the founder's live position onto the roadmap. Given the (per-company or template) task
 * defs, the founder's stage-phase, and their departments, returns the one canonical view every
 * surface renders from.
 */
export function selectRoadmap(
  defs: RoadmapTaskDef[],
  stagePhase: string,
  depts: DeptLike[],
): RoadmapSelection {
  // Per-node done/approve truth from the live departments (matched by the stable roadmap↔task
  // link, then normalized title) — the same overrides the map, beacon, and chat share.
  const overrides = roadmapOverrides(defs, depts);

  // The phase the founder is actively in: floored at their declared stage, advanced past any
  // phase whose work is already done.
  const phase = effectivePhase(defs, stagePhase, overrides);
  const phaseIdx = ROADMAP_PHASES.findIndex((p) => p.key === phase);
  const phaseName = ROADMAP_PHASES[phaseIdx]?.name ?? '';
  const nextMilestone =
    ROADMAP_PHASES[phaseIdx + 1]?.name ?? ROADMAP_PHASES[ROADMAP_PHASES.length - 1]?.name ?? '';

  // The roadmap's own next actionable move: prefer a byte-doable task (`available` → "byte does
  // this next"), else a founder gate (`needsYou`). Identical to nextRoadmapMove, computed here
  // from one provisional pass so the move and the lit node are guaranteed to be the same node.
  const provisional = applyProgress(defs, { currentPhase: phase, currentTaskId: null, overrides });
  const actionable =
    provisional.find((t) => t.phase === phase && t.state === 'available') ??
    provisional.find((t) => t.phase === phase && t.state === 'needsYou') ??
    null;
  const move: RoadmapMove | null = actionable
    ? {
        deptK: actionable.dept,
        title: actionable.title,
        id: actionable.id,
        actor: actionable.actor ?? 'byte',
      }
    : null;

  // Light the move as `current`; if nothing is actionable, keep a focal node on the phase's first
  // task so the map isn't headless. The lit node must not be re-overridden by live-DEPTS truth.
  const firstInPhase = defs.find((d) => d.phase === phase)?.id ?? null;
  const currentTaskId = move?.id ?? firstInPhase;
  const forRender: Partial<Record<string, RoadmapState>> = { ...overrides };
  if (currentTaskId) delete forRender[currentTaskId];
  const tasks = applyProgress(defs, { currentPhase: phase, currentTaskId, overrides: forRender });

  const done = tasks.filter((t) => t.state === 'done').length;
  const total = tasks.length;
  const progress = { done, total, pct: total ? Math.round((done / total) * 100) : 0 };

  return { phase, phaseName, nextMilestone, move, tasks, progress };
}
