// The Overview roadmap, phase 1 — the pure layout engine.
//
// Turns a RoadmapPhase[]/RoadmapTask[] into absolute node positions and orthogonal
// (right-angle) SVG edge paths, in a fixed layered layout: columns = phases (x), rows =
// tasks within a phase (y). Fixed layout — not a physics sim — so it's stable and
// scannable. Deterministic and side-effect-free, so RoadmapView is a thin renderer and the
// geometry is unit-tested. (Coordinates are the same scheme as the approved wireframe.)
import {
  deriveEdges,
  phaseProgress,
  currentTaskId,
  type RoadmapPhase,
  type RoadmapTask,
} from './roadmapModel';

// Geometry — one source of truth for card size + spacing.
export const CARD_W = 208;
export const CARD_H = 64;
export const COL_GAP = 60; // horizontal gap between phase columns
export const ROW_PITCH = 96; // vertical distance between task rows (card + gap)
export const TOP = 40; // space above the first row (room for byte's marker)
export const BOTTOM_PAD = 16;
export const ROOT_W = 172;
export const ROOT_H = 118;
export const ROOT_LEFT = 12;
export const ROOT_GAP = 48; // gap between the root node and the first phase column

const ROOT_RIGHT = ROOT_LEFT + ROOT_W;

// Canonical department lane order (top → bottom): product first, then growth-facing
// functions, then the company-shell functions. Departments read as horizontal tracks in
// this order; any department not listed falls in after these, in first-appearance order.
const DEPT_LANE_ORDER = ['eng', 'design', 'mkt', 'sales', 'support', 'ops', 'fin', 'legal'];

export interface PositionedNode {
  task: RoadmapTask;
  col: number;
  row: number;
  /** Top-left of the card. */
  x: number;
  y: number;
}

export interface EdgePath {
  from: string;
  to: string;
  /** SVG path `d` (orthogonal elbow). */
  d: string;
  critical: boolean;
}

export interface PhaseColumn {
  key: string;
  name: string;
  /** Left x of the column's cards. */
  x: number;
  done: number;
  total: number;
  current: boolean;
}

export interface RoadmapLayout {
  nodes: PositionedNode[];
  edges: EdgePath[];
  columns: PhaseColumn[];
  /** Root (company) node box, or null when hasRoot=false. */
  root: { x: number; y: number; w: number; h: number } | null;
  /** Root → first-phase entry edges (tasks with no in-roadmap dependency). */
  rootEdges: EdgePath[];
  width: number;
  height: number;
}

/** Left x of the phase column at index `col`. */
function colLeft(col: number, hasRoot: boolean): number {
  const start = hasRoot ? ROOT_RIGHT + ROOT_GAP : ROOT_LEFT;
  return start + col * (CARD_W + COL_GAP);
}

/** Top y of the task row at index `row`. */
function rowTop(row: number): number {
  return TOP + row * ROW_PITCH;
}

/** Orthogonal connector from a right-edge point to a left-edge point (x2 ≥ x1). A straight
 *  segment when the rows line up, otherwise an elbow whose vertical sits in the gutter just
 *  left of the TARGET column — so it never crosses an intermediate column's cards, even when
 *  the edge spans more than one column. */
function elbow(x1: number, y1: number, x2: number, y2: number): string {
  if (y1 === y2) return `M${x1},${y1} H${x2}`;
  const mid = Math.round(x2 - COL_GAP / 2);
  return `M${x1},${y1} H${mid} V${y2} H${x2}`;
}

/** Connector between two cards stacked in the SAME column: a hook that drops into the column's
 *  LEFT gutter instead of doubling back through the cards. Both x's are the column's left edge. */
function sideElbow(x1: number, y1: number, x2: number, y2: number): string {
  const g = Math.round(x1 - COL_GAP / 2);
  return `M${x1},${y1} H${g} V${y2} H${x2}`;
}

/**
 * Lay out the roadmap. Phases become columns in the given order; tasks keep their order
 * within a phase as rows. Returns node boxes, edge paths (dependency + root), per-column
 * progress, and the total canvas size.
 */
export function layoutRoadmap(
  phases: RoadmapPhase[],
  tasks: RoadmapTask[],
  hasRoot = true,
): RoadmapLayout {
  const colOf = new Map(phases.map((p, i) => [p.key, i]));

  // ── Department lanes ──────────────────────────────────────────────────────────────────
  // Each department keeps a single horizontal row (a "lane") across the columns it appears
  // in, so a function reads as a track left-to-right (like the reference tech-tree). Depts
  // that never share a column pack onto the same lane (compact); a 2nd task in one
  // (phase, dept) cell spills to the nearest free row in that column only.
  const deptCols = new Map<string, Set<number>>(); // dept → columns it occupies
  const deptSeen: string[] = [];
  for (const t of tasks) {
    const c = colOf.get(t.phase);
    if (c === undefined) continue;
    let cols = deptCols.get(t.dept);
    if (!cols) {
      cols = new Set();
      deptCols.set(t.dept, cols);
      deptSeen.push(t.dept);
    }
    cols.add(c);
  }
  const orderedDepts = [
    ...DEPT_LANE_ORDER.filter((d) => deptCols.has(d)),
    ...deptSeen.filter((d) => !DEPT_LANE_ORDER.includes(d)),
  ];
  // Greedy interval-graph coloring: give each dept the lowest lane whose already-claimed
  // columns don't clash with the dept's columns.
  const laneOf = new Map<string, number>();
  const laneCols: Set<number>[] = [];
  for (const d of orderedDepts) {
    const cols = deptCols.get(d)!;
    let lane = 0;
    while (laneCols[lane] && [...cols].some((c) => laneCols[lane].has(c))) lane++;
    laneOf.set(d, lane);
    if (!laneCols[lane]) laneCols[lane] = new Set();
    for (const c of cols) laneCols[lane].add(c);
  }
  const laneCount = Math.max(1, laneCols.length);

  // Place a task at its dept lane, or the nearest free row in that column if the lane is
  // already taken there (search down, then up, then extend below all lanes).
  const occ = new Map<number, Set<number>>(); // column → rows already taken
  const takeRow = (col: number, lane: number): number => {
    let used = occ.get(col);
    if (!used) {
      used = new Set();
      occ.set(col, used);
    }
    let row = lane;
    if (used.has(row)) {
      row = -1;
      for (let r = lane + 1; r < laneCount && row < 0; r++) if (!used.has(r)) row = r;
      for (let r = lane - 1; r >= 0 && row < 0; r--) if (!used.has(r)) row = r;
      if (row < 0) {
        row = laneCount;
        while (used.has(row)) row++;
      }
    }
    used.add(row);
    return row;
  };

  const nodes: PositionedNode[] = [];
  const nodeById = new Map<string, PositionedNode>();
  for (const task of tasks) {
    const col = colOf.get(task.phase);
    if (col === undefined) continue; // task in an unknown phase → skip, don't crash
    const row = takeRow(col, laneOf.get(task.dept) ?? 0);
    const node: PositionedNode = {
      task,
      col,
      row,
      x: colLeft(col, hasRoot),
      y: rowTop(row),
    };
    nodes.push(node);
    nodeById.set(task.id, node);
  }

  const centerY = (n: PositionedNode) => n.y + CARD_H / 2;
  const rightX = (n: PositionedNode) => n.x + CARD_W;

  const edges: EdgePath[] = deriveEdges(tasks)
    .map((e) => {
      const a = nodeById.get(e.from);
      const b = nodeById.get(e.to);
      if (!a || !b) return null;
      // Same-column (within-phase) deps hook through the left gutter; cross-column deps run
      // from the source's right edge into the target's left gutter.
      const d =
        a.col === b.col
          ? sideElbow(a.x, centerY(a), b.x, centerY(b))
          : elbow(rightX(a), centerY(a), b.x, centerY(b));
      return { from: e.from, to: e.to, critical: e.critical, d };
    })
    .filter((e): e is EdgePath => e !== null);

  // Height is driven by the lowest lane any task lands on.
  const maxRows = Math.max(1, ...nodes.map((n) => n.row + 1));
  const height = TOP + (maxRows - 1) * ROW_PITCH + CARD_H + BOTTOM_PAD;

  const prog = phaseProgress(phases, tasks);
  const currentId = currentTaskId(tasks);
  const currentPhase = currentId ? nodeById.get(currentId)?.task.phase : undefined;
  const columns: PhaseColumn[] = phases.map((p, i) => ({
    key: p.key,
    name: p.name,
    x: colLeft(i, hasRoot),
    done: prog[p.key]?.done ?? 0,
    total: prog[p.key]?.total ?? 0,
    current: p.key === currentPhase,
  }));

  const width = colLeft(phases.length - 1, hasRoot) + CARD_W + BOTTOM_PAD;

  // Root node + fan-out to the entry tasks (those whose deps are all outside the roadmap).
  let root: RoadmapLayout['root'] = null;
  const rootEdges: EdgePath[] = [];
  if (hasRoot) {
    const ry = Math.round((height - ROOT_H) / 2);
    root = { x: ROOT_LEFT, y: ry, w: ROOT_W, h: ROOT_H };
    const rootCx = ROOT_RIGHT;
    const rootCy = ry + ROOT_H / 2;
    const idSet = new Set(tasks.map((t) => t.id));
    for (const n of nodes) {
      const isEntry = n.task.dependsOn.every((d) => !idSet.has(d));
      if (isEntry) {
        rootEdges.push({
          from: '__root__',
          to: n.task.id,
          critical: false,
          d: elbow(rootCx, rootCy, n.x, centerY(n)),
        });
      }
    }
  }

  return { nodes, edges, columns, root, rootEdges, width, height };
}
