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
// Pure and unit-tested; fed the live brief.stage + roadmap defs + DEPTS by OverviewSection.
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
  /** The single task to do next (the roadmap's own next move, via selectRoadmap), lit as
   *  `current`. Its prerequisites are treated as done (you can't be "here" otherwise). */
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

  // The "complete" region: every task in a phase before the current one, plus real shipped work
  // fed in via `overrides` as `done` (so live progress unlocks its dependents), plus the
  // transitive prerequisites of any done task and of byte's current move (you can't be on
  // `current`, or have finished a task, unless its prerequisites are done).
  const done = new Set<string>();
  for (const d of defs) {
    const pi = phaseIdxOf(d);
    // Byte-doable tasks in passed phases are assumed complete; founder-owned (actor 'you') tasks
    // are NOT — the founder actually has to do them, so they stay actionable (`needsYou`) until
    // marked done, surfacing as real gates instead of being silently skipped by phase passage.
    if (pi >= 0 && curIdx >= 0 && pi < curIdx && d.actor !== 'you') done.add(d.id);
  }
  for (const [id, st] of Object.entries(overrides)) {
    if (st === 'done' && byId.has(id)) done.add(id);
  }
  // Complete the transitive prerequisites of done tasks / the current move — but never a
  // founder-owned prerequisite: reaching a later task doesn't prove the founder did their part,
  // so those can't be assumed and must surface for them to actually do.
  const addPrereqs = (id: string) => {
    const d = byId.get(id);
    if (!d) return;
    for (const dep of d.dependsOn) {
      const depDef = byId.get(dep);
      if (!depDef || depDef.actor === 'you' || done.has(dep)) continue;
      done.add(dep);
      addPrereqs(dep);
    }
  };
  if (input.currentTaskId) addPrereqs(input.currentTaskId);
  for (const id of Array.from(done)) addPrereqs(id);

  // A task is unblocked when its prerequisites are met. Founder-owned prerequisites are SOFT
  // gates: they don't block byte's parallel work (byte can build while you incorporate), but they
  // DO sequence other founder-owned tasks (open a bank account only after incorporating).
  const unblocked = (d: RoadmapTaskDef) =>
    d.dependsOn.every((dep) => {
      const depDef = byId.get(dep);
      if (!depDef) return true;
      if (depDef.actor === 'you' && d.actor !== 'you') return true;
      return done.has(dep);
    });

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

/**
 * The phase the founder is actively working in. Floors at their declared stage, then advances
 * past any earlier phase whose every task is already done — so finishing a phase moves the
 * roadmap forward (and the "do this next" beacon to the next real step) instead of stalling on a
 * completed task. Pure; reuses the same applyProgress unlock the map renders.
 */
export function effectivePhase(
  defs: RoadmapTaskDef[],
  stagePhase: string,
  overrides: Partial<Record<string, RoadmapState>> = {},
): string {
  let idx = Math.max(0, PHASE_ORDER.indexOf(stagePhase));
  for (let guard = 0; guard < PHASE_ORDER.length; guard++) {
    const key = PHASE_ORDER[idx];
    const pass = applyProgress(defs, { currentPhase: key, currentTaskId: null, overrides });
    const hasWork = pass.some((t) => t.phase === key && t.state !== 'done');
    if (hasWork || idx === PHASE_ORDER.length - 1) break;
    idx += 1;
  }
  return PHASE_ORDER[idx];
}

/** Build the per-node `done`/`approve` overrides from the live department tasks, matched first by
 *  the stable roadmap↔task link and then by normalized title. The single source of truth so the
 *  map, the beacon, the chat, and the after-completion nudge all agree on what's done. */
/** Canonical title key: lowercased, non-alphanumerics collapsed to single spaces, trimmed.
 *  The single normalizer every roadmap↔task title match shares, so the map, beacon, and chat
 *  can't drift apart on punctuation/casing (see beaconTarget.resolveBeaconTask). */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function roadmapOverrides(
  defs: RoadmapTaskDef[],
  depts: {
    k: string;
    tasks: { t: string; done?: boolean; drafted?: boolean; roadmapNodeId?: string }[];
  }[],
): Partial<Record<string, RoadmapState>> {
  const nm = normalizeTitle;
  const byNode = new Map<string, { done?: boolean; drafted?: boolean }>();
  const byKey = new Map<string, { done?: boolean; drafted?: boolean }>();
  for (const d of depts) {
    for (const t of d.tasks) {
      byKey.set(`${d.k}::${nm(t.t)}`, { done: t.done, drafted: t.drafted });
      if (t.roadmapNodeId) byNode.set(t.roadmapNodeId, { done: t.done, drafted: t.drafted });
    }
  }
  const out: Partial<Record<string, RoadmapState>> = {};
  for (const def of defs) {
    const real = byNode.get(def.id) ?? byKey.get(`${def.dept}::${nm(def.title)}`);
    if (!real) continue;
    if (real.done) out[def.id] = 'done';
    else if (real.drafted) out[def.id] = 'approve';
  }
  return out;
}

/** The roadmap's own next move: the first actionable task in the founder's effective phase —
 *  preferring a byte-doable one (`available`) for "byte does this next", else a founder gate
 *  (`needsYou`). THE single source of "what's next", so the beacon, chat, and nudge never disagree.
 */
export function nextRoadmapMove(
  defs: RoadmapTaskDef[],
  stagePhase: string,
  overrides: Partial<Record<string, RoadmapState>> = {},
): { deptK: string; title: string; id: string } | null {
  const phase = effectivePhase(defs, stagePhase, overrides);
  const pass = applyProgress(defs, { currentPhase: phase, currentTaskId: null, overrides });
  const t =
    pass.find((x) => x.phase === phase && x.state === 'available') ??
    pass.find((x) => x.phase === phase && x.state === 'needsYou');
  return t ? { deptK: t.dept, title: t.title, id: t.id } : null;
}
