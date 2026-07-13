import { describe, it, expect } from 'vitest';
import { focusRoadmap, collapsedId, COLLAPSED_DEPT } from './roadmapFocus';
import type { RoadmapPhase, RoadmapTask } from './roadmapModel';

const phases: RoadmapPhase[] = [
  { key: 'find', name: 'Find' },
  { key: 'build', name: 'Build' },
  { key: 'ship', name: 'Ship' },
];

// Find is fully done; Build is in progress; Ship is entirely locked.
const tasks: RoadmapTask[] = [
  { id: 'f1', phase: 'find', dept: 'mkt', title: 'Validate', state: 'done', dependsOn: [] },
  { id: 'f2', phase: 'find', dept: 'mkt', title: 'Audience', state: 'done', dependsOn: ['f1'] },
  {
    id: 'b1',
    phase: 'build',
    dept: 'eng',
    title: 'Core flow',
    state: 'current',
    dependsOn: ['f1'],
  },
  { id: 'b2', phase: 'build', dept: 'eng', title: 'Auth', state: 'locked', dependsOn: ['b1'] },
  { id: 's1', phase: 'ship', dept: 'eng', title: 'Landing', state: 'locked', dependsOn: ['b1'] },
];

describe('focusRoadmap', () => {
  const { phases: outPhases, tasks: out } = focusRoadmap(phases, tasks);

  it('collapses a fully-done phase into a single ✓ node', () => {
    const findNodes = out.filter((t) => t.phase === 'find');
    expect(findNodes).toHaveLength(1);
    expect(findNodes[0]).toMatchObject({
      id: collapsedId('find'),
      dept: COLLAPSED_DEPT,
      title: 'Find',
      state: 'done',
      collapsed: true,
    });
  });

  it('hides locked tasks but keeps actionable ones', () => {
    expect(out.find((t) => t.id === 'b1')).toBeTruthy(); // current stays
    expect(out.find((t) => t.id === 'b2')).toBeFalsy(); // locked hidden
  });

  it('repoints a live dep from a collapsed task onto the ✓ node', () => {
    const b1 = out.find((t) => t.id === 'b1')!;
    expect(b1.dependsOn).toEqual([collapsedId('find')]);
  });

  it('drops a phase left with no visible node', () => {
    // Ship is entirely locked → gone from both tasks and phases.
    expect(out.some((t) => t.phase === 'ship')).toBe(false);
    expect(outPhases.map((p) => p.key)).toEqual(['find', 'build']);
  });

  it('is a no-op shape when nothing is done or locked', () => {
    const live: RoadmapTask[] = [
      { id: 'x', phase: 'build', dept: 'eng', title: 'X', state: 'current', dependsOn: [] },
    ];
    const r = focusRoadmap(phases, live);
    expect(r.tasks).toHaveLength(1);
    expect(r.tasks[0].collapsed).toBeUndefined();
  });
});
