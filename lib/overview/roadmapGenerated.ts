// The Overview roadmap, phase 4 — byte-generated, per-company roadmap.
//
// byte generates a REAL roadmap for the founder's company (phases → department-tagged tasks
// → dependencies) via /api/roadmap. This module owns the wire shape byte returns and the
// pure conversion into the RoadmapTaskDef[] the layout engine consumes. Dependencies are
// authored by TITLE (reliable for an LLM to reference); we resolve them to ids here.
import { ROADMAP_PHASES } from './roadmapTemplate';
import type { RoadmapTaskDef } from './roadmapModel';

/** The phase keys byte fills tasks into (fixed spine). */
export const ROADMAP_PHASE_KEYS: string[] = ROADMAP_PHASES.map((p) => p.key);
/** The department keys a task can belong to (match lib/data.ts DEPTS). */
export const ROADMAP_DEPT_KEYS = [
  'eng',
  'mkt',
  'ops',
  'fin',
  'legal',
  'design',
  'sales',
  'support',
] as const;

export interface GeneratedTask {
  phase: string;
  dept: string;
  title: string;
  /** Who does the work: `you` = it needs the founder themselves (their judgment, identity, or
   *  presence); `byte` = byte can produce it autonomously. Absent/invalid defaults to `byte`. */
  actor?: 'byte' | 'you';
  /** Titles of prerequisite tasks that must come first — resolved to `dependsOn` ids here. */
  deps: string[];
}
export interface GeneratedRoadmap {
  tasks: GeneratedTask[];
}

const PHASE_SET = new Set<string>(ROADMAP_PHASE_KEYS);
const DEPT_SET = new Set<string>(ROADMAP_DEPT_KEYS);

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'task'
  );
}

/**
 * Convert byte's generated roadmap into task defs the layout engine can lay out: give each
 * task a stable, unique id derived from its title, and resolve `deps` (prerequisite titles)
 * into `dependsOn` ids. Tasks with an unknown phase/department or an empty title are dropped;
 * a dependency naming a task that isn't present is ignored (deriveEdges also guards this).
 */
export function roadmapFromGenerated(gen: GeneratedRoadmap | null | undefined): RoadmapTaskDef[] {
  const rows = (gen?.tasks ?? []).filter(
    (t) => t && PHASE_SET.has(t.phase) && DEPT_SET.has(t.dept) && t.title?.trim(),
  );
  const used = new Set<string>();
  const idByTitle = new Map<string, string>();
  const withId = rows.map((t) => {
    const base = slug(t.title);
    let id = base;
    let n = 2;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    const key = t.title.trim();
    if (!idByTitle.has(key)) idByTitle.set(key, id);
    return { row: t, id };
  });
  return withId.map(({ row, id }) => ({
    id,
    phase: row.phase,
    dept: row.dept,
    title: row.title.trim(),
    // Founder-owned tasks (row.actor === 'you') surface as `needsYou` and gate other founder
    // work; everything else is byte-doable. Absent/invalid actor defaults to byte.
    actor: row.actor === 'you' ? ('you' as const) : ('byte' as const),
    dependsOn: (row.deps ?? [])
      .map((d) => idByTitle.get(typeof d === 'string' ? d.trim() : ''))
      .filter((x): x is string => Boolean(x)),
  }));
}
