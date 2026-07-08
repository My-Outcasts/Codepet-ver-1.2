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
