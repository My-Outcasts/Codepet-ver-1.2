import { describe, it, expect } from 'vitest';
import {
  layoutRoadmap,
  CARD_W,
  CARD_H,
  ROW_PITCH,
  TOP,
  ROOT_W,
  ROOT_LEFT,
  ROOT_GAP,
} from './roadmapLayout';
import type { RoadmapPhase, RoadmapTask } from './roadmapModel';

const phases: RoadmapPhase[] = [
  { key: 'a', name: 'A' },
  { key: 'b', name: 'B' },
];

const tasks: RoadmapTask[] = [
  { id: 't1', phase: 'a', dept: 'eng', title: 'T1', state: 'done', dependsOn: [] },
  { id: 't2', phase: 'a', dept: 'fin', title: 'T2', state: 'done', dependsOn: ['t1'] },
  { id: 't3', phase: 'b', dept: 'mkt', title: 'T3', state: 'current', dependsOn: ['t2'] },
];

describe('layoutRoadmap — positions', () => {
  const L = layoutRoadmap(phases, tasks);

  it('columns advance by card width + gap; rows by pitch', () => {
    const firstColX = ROOT_LEFT + ROOT_W + ROOT_GAP;
    const n1 = L.nodes.find((n) => n.task.id === 't1')!;
    const n2 = L.nodes.find((n) => n.task.id === 't2')!;
    const n3 = L.nodes.find((n) => n.task.id === 't3')!;
    expect([n1.x, n1.y]).toEqual([firstColX, TOP]); // phase A, row 0
    expect([n2.x, n2.y]).toEqual([firstColX, TOP + ROW_PITCH]); // phase A, row 1
    expect([n3.x, n3.y]).toEqual([firstColX + CARD_W + 60, TOP]); // phase B, row 0
  });

  it('height is driven by the tallest column (2 rows here)', () => {
    expect(L.height).toBe(TOP + 1 * ROW_PITCH + CARD_H + 16);
  });

  it('skips tasks in an unknown phase instead of crashing', () => {
    const L2 = layoutRoadmap(phases, [
      ...tasks,
      { id: 'x', phase: 'ghost', dept: 'eng', title: 'X', state: 'locked', dependsOn: [] },
    ]);
    expect(L2.nodes.find((n) => n.task.id === 'x')).toBeUndefined();
  });
});

describe('layoutRoadmap — department lanes', () => {
  const p3: RoadmapPhase[] = [
    { key: 'a', name: 'A' },
    { key: 'b', name: 'B' },
    { key: 'c', name: 'C' },
  ];

  it('keeps a department on the same row across the columns it appears in', () => {
    const t: RoadmapTask[] = [
      { id: 'e1', phase: 'a', dept: 'eng', title: 'E1', state: 'done', dependsOn: [] },
      { id: 'm1', phase: 'a', dept: 'mkt', title: 'M1', state: 'available', dependsOn: [] },
      { id: 'e2', phase: 'c', dept: 'eng', title: 'E2', state: 'available', dependsOn: ['e1'] },
    ];
    const L = layoutRoadmap(p3, t);
    const e1 = L.nodes.find((n) => n.task.id === 'e1')!;
    const e2 = L.nodes.find((n) => n.task.id === 'e2')!;
    const m1 = L.nodes.find((n) => n.task.id === 'm1')!;
    expect(e1.row).toBe(e2.row); // eng is one lane across columns a and c
    expect(m1.row).not.toBe(e1.row); // mkt shares column a → a different lane
  });

  it('spills a 2nd task in the same (phase, dept) cell to another row', () => {
    const t: RoadmapTask[] = [
      { id: 'e1', phase: 'a', dept: 'eng', title: 'E1', state: 'done', dependsOn: [] },
      { id: 'e2', phase: 'a', dept: 'eng', title: 'E2', state: 'available', dependsOn: ['e1'] },
    ];
    const L = layoutRoadmap(p3, t);
    const e1 = L.nodes.find((n) => n.task.id === 'e1')!;
    const e2 = L.nodes.find((n) => n.task.id === 'e2')!;
    expect(e1.row).not.toBe(e2.row);
  });

  it('packs departments that never share a column onto the same lane', () => {
    const t: RoadmapTask[] = [
      { id: 'a1', phase: 'a', dept: 'eng', title: 'A1', state: 'done', dependsOn: [] },
      { id: 'b1', phase: 'b', dept: 'design', title: 'B1', state: 'available', dependsOn: [] },
    ];
    const L = layoutRoadmap(p3, t);
    const a1 = L.nodes.find((n) => n.task.id === 'a1')!;
    const b1 = L.nodes.find((n) => n.task.id === 'b1')!;
    expect(a1.row).toBe(b1.row); // disjoint columns → shared lane 0
  });
});

describe('layoutRoadmap — edges', () => {
  const L = layoutRoadmap(phases, tasks);

  it('draws a straight connector when rows line up', () => {
    // t2 (row 1, phase A) → t3 (row 0, phase B) are different rows → elbow;
    // t1 (row 0) → t2 (row 1) different rows → elbow. Use a same-row case:
    const sameRow: RoadmapTask[] = [
      { id: 'p', phase: 'a', dept: 'eng', title: 'P', state: 'done', dependsOn: [] },
      { id: 'q', phase: 'b', dept: 'eng', title: 'Q', state: 'available', dependsOn: ['p'] },
    ];
    const e = layoutRoadmap(phases, sameRow).edges[0];
    expect(e.d).toMatch(/^M\d+,\d+ H\d+$/); // straight H only
  });

  it('draws an elbow (H V H) when rows differ', () => {
    const e = L.edges.find((x) => x.from === 't2' && x.to === 't3')!;
    expect(e.d).toMatch(/^M\d+,\d+ H\d+ V\d+ H\d+$/);
    expect(e.critical).toBe(true);
  });
});

describe('layoutRoadmap — root', () => {
  it('emits a root box and fans out to entry tasks (deps outside the roadmap)', () => {
    const L = layoutRoadmap(phases, tasks);
    expect(L.root).not.toBeNull();
    expect(L.root!.x).toBe(ROOT_LEFT);
    // Only t1 has no in-roadmap dependency → single root edge.
    expect(L.rootEdges.map((e) => e.to)).toEqual(['t1']);
  });

  it('omits the root when hasRoot=false', () => {
    const L = layoutRoadmap(phases, tasks, false);
    expect(L.root).toBeNull();
    expect(L.rootEdges).toEqual([]);
  });
});

describe('layoutRoadmap — columns', () => {
  it('reports per-column progress and marks the current phase', () => {
    const cols = layoutRoadmap(phases, tasks).columns;
    expect(cols.find((c) => c.key === 'a')).toMatchObject({ done: 2, total: 2, current: false });
    expect(cols.find((c) => c.key === 'b')).toMatchObject({ done: 0, total: 1, current: true });
  });
});
