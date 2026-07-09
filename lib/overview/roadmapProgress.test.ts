import { describe, it, expect } from 'vitest';
import { stageToPhase, applyProgress } from './roadmapProgress';
import type { RoadmapTaskDef } from './roadmapModel';

describe('stageToPhase', () => {
  it('maps onboarding stages onto roadmap phases', () => {
    expect(stageToPhase('Just an idea')).toBe('find');
    expect(stageToPhase('Prototype')).toBe('build');
    expect(stageToPhase('Private beta')).toBe('ship');
    expect(stageToPhase('Growing')).toBe('grow');
  });
  it('falls back to build for an unknown/absent stage', () => {
    expect(stageToPhase(undefined)).toBe('build');
    expect(stageToPhase('nonsense')).toBe('build');
  });
});

const defs: RoadmapTaskDef[] = [
  { id: 'a1', phase: 'find', dept: 'mkt', title: 'A1', dependsOn: [] },
  { id: 'b1', phase: 'build', dept: 'eng', title: 'B1', dependsOn: [] },
  { id: 's1', phase: 'ship', dept: 'fin', title: 'S1', dependsOn: [] },
  { id: 's2', phase: 'ship', dept: 'legal', title: 'S2', dependsOn: [] },
  { id: 'l1', phase: 'launch', dept: 'mkt', title: 'L1', dependsOn: [] },
];

describe('applyProgress', () => {
  const out = applyProgress(defs, { currentPhase: 'ship', currentTaskId: 's1' });
  const state = (id: string) => out.find((t) => t.id === id)!.state;

  it('marks passed phases done', () => {
    expect(state('a1')).toBe('done'); // find (before ship)
    expect(state('b1')).toBe('done'); // build (before ship)
  });
  it('marks the current phase available, with the next move as current', () => {
    expect(state('s1')).toBe('current'); // the next-step task
    expect(state('s2')).toBe('available'); // other current-phase task
  });
  it('marks phases ahead locked', () => {
    expect(state('l1')).toBe('locked'); // launch (after ship)
  });
  it('keeps the task structure intact (id/phase/dept/title/dependsOn)', () => {
    const s1 = out.find((t) => t.id === 's1')!;
    expect(s1).toMatchObject({ id: 's1', phase: 'ship', dept: 'fin', title: 'S1', dependsOn: [] });
  });

  it('lets per-task overrides win over the position-derived state', () => {
    const o = applyProgress(defs, {
      currentPhase: 'ship',
      currentTaskId: 's1',
      overrides: { s2: 'needsYou', b1: 'approve' },
    });
    expect(o.find((t) => t.id === 's2')!.state).toBe('needsYou');
    expect(o.find((t) => t.id === 'b1')!.state).toBe('approve'); // override beats "done"
  });

  it('does not mark a current task outside the current phase', () => {
    // next-step points at a build task while the founder is in ship → build is a passed
    // phase, so it stays done, not current.
    const o = applyProgress(defs, { currentPhase: 'ship', currentTaskId: 'b1' });
    expect(o.find((t) => t.id === 'b1')!.state).toBe('done');
    expect(o.some((t) => t.state === 'current')).toBe(false);
  });
});

describe('applyProgress — dependency unlock', () => {
  // x1(build) → c1(ship) → c2(ship); y1(ship, founder-only) depends on x1; f1(launch) is a
  // no-dependency task in a future phase.
  const dep: RoadmapTaskDef[] = [
    { id: 'x1', phase: 'build', dept: 'eng', title: 'X1', dependsOn: [] },
    { id: 'c1', phase: 'ship', dept: 'eng', title: 'C1', dependsOn: ['x1'] },
    { id: 'c2', phase: 'ship', dept: 'eng', title: 'C2', dependsOn: ['c1'] },
    { id: 'y1', phase: 'ship', dept: 'legal', title: 'Y1', actor: 'you', dependsOn: ['x1'] },
    { id: 'f1', phase: 'launch', dept: 'mkt', title: 'F1', dependsOn: [] },
  ];

  it('locks a current-phase task whose prerequisite is not done yet', () => {
    const o = applyProgress(dep, { currentPhase: 'ship', currentTaskId: 'c1' });
    const st = (id: string) => o.find((t) => t.id === id)!.state;
    expect(st('c1')).toBe('current'); // the next move
    expect(st('c2')).toBe('locked'); // waits on c1 (still current, not done)
    expect(st('x1')).toBe('done'); // passed phase
  });

  it('marks an unblocked founder-only task as needsYou', () => {
    const o = applyProgress(dep, { currentPhase: 'ship', currentTaskId: 'c1' });
    // y1's only prerequisite (x1) is done → unblocked; actor 'you' → needsYou
    expect(o.find((t) => t.id === 'y1')!.state).toBe('needsYou');
  });

  it('treats the current move’s prerequisites as done', () => {
    const o = applyProgress(dep, { currentPhase: 'ship', currentTaskId: 'c2' });
    const st = (id: string) => o.find((t) => t.id === id)!.state;
    expect(st('c1')).toBe('done'); // prerequisite of the current move → complete
    expect(st('c2')).toBe('current');
  });

  it('keeps a future-phase task locked even with no unmet dependencies', () => {
    const o = applyProgress(dep, { currentPhase: 'ship', currentTaskId: 'c1' });
    expect(o.find((t) => t.id === 'f1')!.state).toBe('locked'); // launch is ahead of ship
  });
});
