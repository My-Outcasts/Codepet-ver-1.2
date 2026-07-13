// The Overview roadmap — Focus mode (a pure task-set transform).
//
// Focus reshapes the roadmap to "what you've done (compact) + what you can act on now":
//   • every fully-completed phase collapses to a single ✓ node, and
//   • locked (not-yet-reachable) tasks are hidden.
// It feeds the SAME layout engine (layoutRoadmap) a smaller task set — the engine already drops
// edges to missing nodes and re-detects entry nodes — so nothing in the geometry (or its tests)
// changes. Dependencies are rewired so the ✓ nodes chain into a left-to-right "done" spine and the
// live work still connects back to them.
import type { RoadmapPhase, RoadmapTask } from './roadmapModel';

/** Synthetic id for a collapsed phase's ✓ node. */
export const collapsedId = (phaseKey: string): string => `__done_${phaseKey}`;
/** The lane key shared by every ✓ node, so they align on one row. */
export const COLLAPSED_DEPT = '__done';

export function focusRoadmap(
  phases: RoadmapPhase[],
  tasks: RoadmapTask[],
): { phases: RoadmapPhase[]; tasks: RoadmapTask[] } {
  // Group tasks by phase to decide which phases are fully done.
  const byPhase = new Map<string, RoadmapTask[]>();
  for (const t of tasks) {
    const arr = byPhase.get(t.phase);
    if (arr) arr.push(t);
    else byPhase.set(t.phase, [t]);
  }
  // A phase collapses when it has tasks and every one is done.
  const collapsed = new Set<string>();
  for (const p of phases) {
    const ts = byPhase.get(p.key);
    if (ts && ts.length > 0 && ts.every((t) => t.state === 'done')) collapsed.add(p.key);
  }

  // Repoint any dependency that landed in a collapsed phase onto that phase's ✓ node.
  const idRemap = new Map<string, string>();
  for (const t of tasks) if (collapsed.has(t.phase)) idRemap.set(t.id, collapsedId(t.phase));

  const out: RoadmapTask[] = [];

  // One ✓ node per collapsed phase, chained to the previous collapsed phase so they read as a
  // spine the live work hangs off (the first one becomes a root entry).
  let prevDone: string | null = null;
  for (const p of phases) {
    if (!collapsed.has(p.key)) continue;
    const id = collapsedId(p.key);
    out.push({
      id,
      phase: p.key,
      dept: COLLAPSED_DEPT,
      title: p.name,
      state: 'done',
      actor: 'byte',
      collapsed: true,
      dependsOn: prevDone ? [prevDone] : [],
    });
    prevDone = id;
  }

  // Keep the live tasks — drop locked and the collapsed originals. Rewrite each kept task's deps
  // through the remap; deps to hidden (locked) tasks simply fall away.
  const kept = new Set<string>();
  for (const t of tasks) if (!collapsed.has(t.phase) && t.state !== 'locked') kept.add(t.id);
  for (const t of tasks) {
    if (collapsed.has(t.phase) || t.state === 'locked') continue;
    const deps = new Set<string>();
    for (const d of t.dependsOn) {
      const mapped = idRemap.get(d) ?? d;
      if (kept.has(mapped) || mapped.startsWith('__done_')) deps.add(mapped);
    }
    out.push({ ...t, dependsOn: [...deps] });
  }

  // Drop phases that ended up with no visible node (fully-locked future phases), preserving order.
  const present = new Set(out.map((t) => t.phase));
  return { phases: phases.filter((p) => present.has(p.key)), tasks: out };
}
