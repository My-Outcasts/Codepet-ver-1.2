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
export const CARD_W = 186;
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
 *  segment when the rows line up, otherwise a mid-gutter elbow — the reference's look. */
function elbow(x1: number, y1: number, x2: number, y2: number): string {
  if (y1 === y2) return `M${x1},${y1} H${x2}`;
  const mid = Math.round((x1 + x2) / 2);
  return `M${x1},${y1} H${mid} V${y2} H${x2}`;
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
  const rowCounter = new Map<string, number>(); // phase key → next row

  const nodes: PositionedNode[] = [];
  const nodeById = new Map<string, PositionedNode>();
  for (const task of tasks) {
    const col = colOf.get(task.phase);
    if (col === undefined) continue; // task in an unknown phase → skip, don't crash
    const row = rowCounter.get(task.phase) ?? 0;
    rowCounter.set(task.phase, row + 1);
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
      return {
        from: e.from,
        to: e.to,
        critical: e.critical,
        d: elbow(rightX(a), centerY(a), b.x, centerY(b)),
      };
    })
    .filter((e): e is EdgePath => e !== null);

  // Height is driven by the tallest column.
  const maxRows = Math.max(1, ...phases.map((p) => rowCounter.get(p.key) ?? 0));
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
