// The Overview roadmap, phase 2 — deriving real progress onto the canonical journey.
//
// The template (roadmapTemplate.ts) is fixed structure; a founder's position turns it into
// live states. `applyProgress` colours the map from where they actually are: phases they've
// passed are done, the phase they're in is available (with byte's single next move lit as
// `current`), phases ahead are locked. `overrides` lets richer per-task truth (from DEPTS —
// e.g. a specific task that needs the founder or is awaiting approval) win when we have it.
//
// Pure and unit-tested; a later step feeds it the live brief.stage + /api/next-step + DEPTS.
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
  /** The single task byte says to do next (from /api/next-step), lit as `current` when it
   *  falls in the current phase. */
  currentTaskId?: string | null;
  /** Per-task state overrides (from real DEPTS data) — win over the position-derived state. */
  overrides?: Partial<Record<string, RoadmapState>>;
}

/**
 * Colour the template from the founder's position. For each task: an override wins; otherwise
 * a task in a passed phase is `done`, a task in a phase ahead is `locked`, and a task in the
 * current phase is `current` (the next move) or `available`.
 */
export function applyProgress(defs: RoadmapTaskDef[], input: ProgressInput): RoadmapTask[] {
  const curIdx = PHASE_ORDER.indexOf(input.currentPhase);
  const overrides = input.overrides ?? {};
  return defs.map((def) => {
    const forced = overrides[def.id];
    let state: RoadmapState;
    if (forced) {
      state = forced;
    } else {
      const phaseIdx = PHASE_ORDER.indexOf(def.phase);
      if (phaseIdx >= 0 && curIdx >= 0 && phaseIdx < curIdx) state = 'done';
      else if (phaseIdx >= 0 && curIdx >= 0 && phaseIdx > curIdx) state = 'locked';
      else state = def.id === input.currentTaskId ? 'current' : 'available';
    }
    return { ...def, state };
  });
}
