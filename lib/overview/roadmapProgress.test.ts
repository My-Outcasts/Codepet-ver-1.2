import { describe, it, expect } from 'vitest';
import { stageToPhase, applyProgress, effectivePhase } from './roadmapProgress';
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

  it('a real (override) done unlocks its dependent', () => {
    // With no current move, c2 waits on c1.
    const before = applyProgress(dep, { currentPhase: 'ship', currentTaskId: null });
    expect(before.find((t) => t.id === 'c2')!.state).toBe('locked');
    // Marking c1 done via overrides (real shipped work) counts toward the unlock set.
    const after = applyProgress(dep, {
      currentPhase: 'ship',
      currentTaskId: null,
      overrides: { c1: 'done' },
    });
    expect(after.find((t) => t.id === 'c1')!.state).toBe('done');
    expect(after.find((t) => t.id === 'c2')!.state).toBe('available'); // c1 done → c2 unblocked
  });

  it('an approve override does NOT unlock its dependent (a draft is not done)', () => {
    const o = applyProgress(dep, {
      currentPhase: 'ship',
      currentTaskId: null,
      overrides: { c1: 'approve' },
    });
    expect(o.find((t) => t.id === 'c1')!.state).toBe('approve');
    expect(o.find((t) => t.id === 'c2')!.state).toBe('locked'); // c1 not done → c2 stays locked
  });
});

describe('applyProgress — founder-owned tasks are real, reachable gates', () => {
  // fv(byte,find) → inc(you,foundation) → bank(you,foundation); core(byte,build) also needs inc.
  const fdefs: RoadmapTaskDef[] = [
    { id: 'fv', phase: 'find', dept: 'mkt', title: 'Validate', dependsOn: [] },
    {
      id: 'inc',
      phase: 'foundation',
      dept: 'legal',
      title: 'Incorporate',
      actor: 'you',
      dependsOn: ['fv'],
    },
    {
      id: 'bank',
      phase: 'foundation',
      dept: 'fin',
      title: 'Bank account',
      actor: 'you',
      dependsOn: ['inc'],
    },
    { id: 'core', phase: 'build', dept: 'eng', title: 'Core product', dependsOn: ['inc'] },
  ];
  const st = (o: ReturnType<typeof applyProgress>, id: string) => o.find((t) => t.id === id)!.state;

  it('does not auto-complete a founder task in a passed phase — it surfaces as needsYou', () => {
    const o = applyProgress(fdefs, { currentPhase: 'build', currentTaskId: null });
    expect(st(o, 'fv')).toBe('done'); // byte task in a passed phase → assumed done
    expect(st(o, 'inc')).toBe('needsYou'); // founder task NOT auto-done → actionable
  });

  it('a founder prerequisite is a SOFT gate — it does not block byte parallel work', () => {
    const o = applyProgress(fdefs, { currentPhase: 'build', currentTaskId: null });
    expect(st(o, 'core')).toBe('available'); // byte can build while you incorporate
    expect(st(o, 'inc')).toBe('needsYou');
  });

  it('founder tasks are sequenced by their founder prerequisites', () => {
    const o = applyProgress(fdefs, { currentPhase: 'build', currentTaskId: null });
    expect(st(o, 'bank')).toBe('locked'); // a bank account waits for incorporation
  });

  it('marking a founder task done unlocks the next founder task', () => {
    const o = applyProgress(fdefs, {
      currentPhase: 'build',
      currentTaskId: null,
      overrides: { inc: 'done' },
    });
    expect(st(o, 'inc')).toBe('done');
    expect(st(o, 'bank')).toBe('needsYou'); // incorporate done → bank is now the founder's move
  });

  it('being on the current move does not assume a founder prerequisite is done', () => {
    const o = applyProgress(fdefs, { currentPhase: 'build', currentTaskId: 'core' });
    expect(st(o, 'core')).toBe('current');
    expect(st(o, 'inc')).toBe('needsYou'); // reaching `core` doesn't prove you incorporated
  });
});

describe('effectivePhase — advances as work completes, floored at the stage', () => {
  // one task per phase; `o` (foundation) is founder-owned.
  const pdefs: RoadmapTaskDef[] = [
    { id: 'f', phase: 'find', dept: 'mkt', title: 'F', dependsOn: [] },
    { id: 'o', phase: 'foundation', dept: 'legal', title: 'O', actor: 'you', dependsOn: ['f'] },
    { id: 'b', phase: 'build', dept: 'eng', title: 'B', dependsOn: ['f'] },
    { id: 's', phase: 'ship', dept: 'fin', title: 'S', dependsOn: ['b'] },
    { id: 'l', phase: 'launch', dept: 'mkt', title: 'L', dependsOn: ['s'] },
    { id: 'g', phase: 'grow', dept: 'ops', title: 'G', dependsOn: ['l'] },
  ];

  it('stays in the stage phase while it still has work', () => {
    expect(effectivePhase(pdefs, 'find', {})).toBe('find');
  });

  it('advances to the next phase with work once the phase is complete', () => {
    // find done → foundation still has the (founder) gate, so we land there.
    expect(effectivePhase(pdefs, 'find', { f: 'done' })).toBe('foundation');
  });

  it('completing a founder gate advances past its phase', () => {
    expect(effectivePhase(pdefs, 'find', { f: 'done', o: 'done' })).toBe('build');
  });

  it('never regresses below the declared stage', () => {
    expect(effectivePhase(pdefs, 'ship', {})).toBe('ship');
  });

  it('lands on the final phase when everything is done', () => {
    const done = { f: 'done', o: 'done', b: 'done', s: 'done', l: 'done', g: 'done' } as const;
    expect(effectivePhase(pdefs, 'find', done)).toBe('grow');
  });
});
