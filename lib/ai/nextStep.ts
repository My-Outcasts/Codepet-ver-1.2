// The shape of byte's single "next step" — the one value the Overview beacon and byte's chat
// both read, so they never disagree about what's next. Derived synchronously from the roadmap
// itself in the store (computeRoadmapNext → selectRoadmap().move); see lib/store.tsx.
//
// This was once produced by an LLM picker (/api/next-step + fetchNextStep). That route grounded
// on a DEPTS task catalog and returned no roadmap node id, which conflicts with the beacon's
// node-link resolution — so it was removed. A decision-aware live next-step, if wanted, should be
// rebuilt on top of a shared roadmap↔task join key (see the "Roadmap↔work join key" plan).
export interface NextStep {
  deptK: string;
  taskTitle: string;
  why: string;
  /** The roadmap node id this step came from — the stable link the Overview beacon resolves
   *  against (see beaconTarget.resolveBeaconTask) so the map and chat name the same task. */
  nodeId?: string;
}
