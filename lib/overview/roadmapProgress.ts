// The Overview roadmap, phase 2 — deriving real progress onto the canonical journey.
//
// The template (roadmapTemplate.ts) is fixed structure; a founder's position turns it into
// live states. `applyProgress` colours the map with a dependency-driven unlock model so the
// roadmap answers three questions at a glance: where the product is (done region + current
// phase), what to do first (the unblocked frontier — available/needsYou, gated by prerequisites),
// and what's next (byte's single `current` move). Tasks whose prerequisites aren't done read as
// `locked` ("needs earlier steps"); `overrides` let richer per-task truth (from DEPTS — e.g. a
// task awaiting approval) win when we have it.
//
// Pure and unit-tested; fed the live brief.stage + /api/next-step + DEPTS by OverviewSection.
import { ROADMAP_PHASES } from './roadmapTemplate';
import type { RoadmapState, RoadmapTask, RoadmapTaskDef } from './roadmapModel';

const PHASE_ORDER = ROADMAP_PHASES.map((p) => p.key);

// Map the founder's self-reported onboarding stage (lib/data.ts OB_STAGES) to the roadmap
// phase they're currently in. Foundation sits between Find and Build, so anyone past "just an
// idea" has passed it — it shows done, which is honest for a founder already building.
const STAGE_TO_PHASE: Record<string, string> = {
  'Just an idea': 'find',
  Prototype: 'build',
  'Private beta': 'ship',
  'Public beta': 'launch',
  Launched: 'launch',
  Growing: 'grow',
};

/** The roadmap phase the founder is in, from their OB_STAGE. Falls back to `build` (a safe
 *  mid-journey default) for an unknown/absent stage. */
export function stageToPhase(obStage: string | undefined | null): string {
  return (obStage && STAGE_TO_PHASE[obStage]) || 'build';
}

export interface ProgressInput {
  /** Phase key the founder is currently in (see stageToPhase). */
  currentPhase: string;
  /** The single task byte says to do next (from /api/next-step), lit as `current`. Its
   *  prerequisites are treated as done (you can't be "here" otherwise). */
  currentTaskId?: string | null;
  /** Per-task state overrides (from real DEPTS data) — win over the derived state. Use for
   *  richer truth like a specific task awaiting approval (`approve`). */
  overrides?: Partial<Record<string, RoadmapState>>;
}

/**
 * Colour the template from the founder's position — a **dependency-driven unlock** model so a
 * user can read where they are, what to do first, and what's next:
 *
 *  - **done**   — a task in a phase the founder has passed, or a prerequisite of the current
 *                 move (reaching `current` means its prerequisites are complete).
 *  - **current**— the single task byte says to do next; always unblocked (its prereqs are done).
 *  - **locked** ("needs earlier steps") — a task in a future phase, or a current-phase task
 *                 whose prerequisites aren't done yet. This is what gates "what to do first".
 *  - **available** / **needsYou** — an unblocked current-phase task: `needsYou` when only the
 *                 founder can do it (`actor: 'you'`), otherwise `available` (byte can do it).
 *
 * `overrides` win first, so live per-task truth (e.g. a draft awaiting `approve`) beats the
 * derivation. Pure and unit-tested.
 */
export function applyProgress(defs: RoadmapTaskDef[], input: ProgressInput): RoadmapTask[] {
  const curIdx = PHASE_ORDER.indexOf(input.currentPhase);
  const overrides = input.overrides ?? {};
  const byId = new Map(defs.map((d) => [d.id, d]));
  const phaseIdxOf = (d: RoadmapTaskDef) => PHASE_ORDER.indexOf(d.phase);

  // The "complete" region: every task in a phase before the current one, plus the transitive
  // prerequisites of byte's current move (you can't be on `current` unless they're done).
  const done = new Set<string>();
  for (const d of defs) {
    const pi = phaseIdxOf(d);
    if (pi >= 0 && curIdx >= 0 && pi < curIdx) done.add(d.id);
  }
  const addPrereqs = (id: string) => {
    const d = byId.get(id);
    if (!d) return;
    for (const dep of d.dependsOn) {
      if (byId.has(dep) && !done.has(dep)) {
        done.add(dep);
        addPrereqs(dep);
      }
    }
  };
  if (input.currentTaskId) addPrereqs(input.currentTaskId);

  const unblocked = (d: RoadmapTaskDef) =>
    d.dependsOn.every((dep) => !byId.has(dep) || done.has(dep));

  return defs.map((def) => {
    const forced = overrides[def.id];
    let state: RoadmapState;
    if (forced) {
      state = forced;
    } else if (done.has(def.id)) {
      state = 'done';
    } else if (def.id === input.currentTaskId) {
      state = 'current';
    } else if (phaseIdxOf(def) > curIdx) {
      state = 'locked'; // a phase ahead — not yet, even if its deps happen to be met
    } else if (unblocked(def)) {
      state = def.actor === 'you' ? 'needsYou' : 'available';
    } else {
      state = 'locked'; // current phase, but prerequisites aren't done → needs earlier steps
    }
    return { ...def, state };
  });
}
