import { describe, it, expect } from 'vitest';
import {
  deriveEdges,
  phaseProgress,
  currentTaskId,
  type RoadmapPhase,
  type RoadmapTask,
} from './roadmapModel';

const phases: RoadmapPhase[] = [
  { key: 'a', name: 'A' },
  { key: 'b', name: 'B' },
];

const tasks: RoadmapTask[] = [
  { id: 't1', phase: 'a', dept: 'eng', title: 'T1', state: 'done', dependsOn: [] },
  { id: 't2', phase: 'a', dept: 'fin', title: 'T2', state: 'done', dependsOn: ['t1'] },
  { id: 't3', phase: 'b', dept: 'mkt', title: 'T3', state: 'current', dependsOn: ['t2'] },
  { id: 't4', phase: 'b', dept: 'sales', title: 'T4', state: 'locked', dependsOn: ['t3'] },
];

describe('currentTaskId', () => {
  it('returns the single current task', () => {
    expect(currentTaskId(tasks)).toBe('t3');
  });
  it('returns null when nothing is current', () => {
    expect(currentTaskId([tasks[0]])).toBeNull();
  });
});

describe('deriveEdges', () => {
  it('makes one edge per in-roadmap dependency, from → to', () => {
    const edges = deriveEdges(tasks);
    expect(edges).toEqual([
      { from: 't1', to: 't2', critical: false },
      { from: 't2', to: 't3', critical: true }, // touches the current node
      { from: 't3', to: 't4', critical: true }, // touches the current node
    ]);
  });

  it('flags exactly the edges touching the current task as critical', () => {
    const crit = deriveEdges(tasks).filter((e) => e.critical);
    expect(crit.map((e) => `${e.from}->${e.to}`)).toEqual(['t2->t3', 't3->t4']);
  });

  it('drops dangling dependencies (id not present)', () => {
    const t: RoadmapTask[] = [
      { id: 'x', phase: 'a', dept: 'eng', title: 'X', state: 'available', dependsOn: ['ghost'] },
    ];
    expect(deriveEdges(t)).toEqual([]);
  });
});

describe('phaseProgress', () => {
  it('counts done / total per phase', () => {
    expect(phaseProgress(phases, tasks)).toEqual({
      a: { done: 2, total: 2 },
      b: { done: 0, total: 2 },
    });
  });
  it('lists every phase even when it has no tasks', () => {
    expect(phaseProgress([{ key: 'z', name: 'Z' }], tasks)).toEqual({ z: { done: 0, total: 0 } });
  });
});
