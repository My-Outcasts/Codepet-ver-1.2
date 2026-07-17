// Resolve the store's single `nextStep` (a roadmap move) to the concrete live department task the
// Overview beacon should light. This is the REVERSE of roadmapOverrides: instead of projecting
// DEPTS state onto the roadmap, it finds the DEPTS task a roadmap move points at, using the SAME
// stable link (roadmapNodeId first, then normalized title) so the beacon and byte's chat can never
// name different tasks. Returns null when the move has no live task to light — the caller shows no
// star rather than falling back to a different roadmap model (the D1 fix). Pure + unit-tested.
import { normalizeTitle } from './roadmapProgress';

/** The store's next-step move, in the minimal shape this resolver needs. */
export interface BeaconMove {
  deptK: string;
  taskTitle: string;
  /** The roadmap node id the move came from — the authoritative link when present. */
  nodeId?: string;
}

/** The minimal department shape — a structural subset of DEPTS. */
export interface BeaconDept {
  k: string;
  tasks: { t: string; done?: boolean; roadmapNodeId?: string }[];
}

/** Where the beacon should light: which department and which task index within it. */
export interface BeaconTarget {
  deptK: string;
  index: number;
}

/**
 * Find the open department task a roadmap move points at. Match order:
 *   1. by `roadmapNodeId` — the stable link, checked across ALL departments (authoritative);
 *   2. else by normalized title WITHIN the move's own department.
 * Only open (not-done) tasks are eligible — a completed task is never a "next step" beacon.
 * Returns null when neither match lands, so the beacon stays dark instead of pointing elsewhere.
 */
export function resolveBeaconTask(
  move: BeaconMove | null | undefined,
  depts: BeaconDept[],
): BeaconTarget | null {
  if (!move) return null;

  // 1) Node link — the authoritative match, valid regardless of which department it lives in.
  if (move.nodeId) {
    for (const d of depts) {
      const index = d.tasks.findIndex((t) => t.roadmapNodeId === move.nodeId && !t.done);
      if (index >= 0) return { deptK: d.k, index };
    }
  }

  // 2) Normalized title within the move's stated department.
  const dept = depts.find((d) => d.k === move.deptK);
  if (dept) {
    const want = normalizeTitle(move.taskTitle);
    const index = dept.tasks.findIndex((t) => !t.done && normalizeTitle(t.t) === want);
    if (index >= 0) return { deptK: dept.k, index };
  }

  return null;
}
