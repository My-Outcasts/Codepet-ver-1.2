import { describe, it, expect, afterEach } from 'vitest';
import { DEPTS, OB_STAGES, PHASES, type Task } from './data';
import {
  nextPhaseName,
  currentPhaseName,
  nextStageOf,
  stageComplete,
  currentStageProgress,
} from './stages';

describe('nextStageOf', () => {
  it('returns the next rung on the ladder', () => {
    expect(nextStageOf('Just an idea')).toBe('Prototype');
    expect(nextStageOf('Private beta')).toBe('Public beta');
    expect(nextStageOf('Launched')).toBe('Growing');
  });
  it('returns null at the top rung', () => {
    expect(nextStageOf('Growing')).toBeNull();
  });
  it('returns null for unknown or missing stages', () => {
    expect(nextStageOf(undefined)).toBeNull();
    expect(nextStageOf('nonsense')).toBeNull();
  });
  it('is case-insensitive, matching stageIndexOf', () => {
    expect(nextStageOf('private beta')).toBe('Public beta');
  });
});

describe('stageComplete', () => {
  // Snapshot + restore the shared DEPTS singleton around each case.
  const snap = DEPTS.map((d) => ({ tasks: d.tasks, later: d.later }));
  const task = (done: boolean): Task => ({ t: 'x', done }) as Task;
  afterEach(() => {
    DEPTS.forEach((d, i) => {
      d.tasks = snap[i].tasks;
      d.later = snap[i].later;
    });
  });

  it('is false while any active task is unfinished', () => {
    DEPTS.forEach((d) => {
      d.later = false;
      d.tasks = [task(true), task(false)];
    });
    expect(stageComplete()).toBe(false);
  });

  it('is true when every active task is done', () => {
    DEPTS.forEach((d) => {
      d.later = false;
      d.tasks = [task(true)];
    });
    expect(stageComplete()).toBe(true);
  });

  it('ignores dormant (later) departments', () => {
    DEPTS.forEach((d, i) => {
      if (i === 0) {
        d.later = false;
        d.tasks = [task(true)];
      } else {
        d.later = true;
        d.tasks = [task(false)]; // dormant — must not block completion
      }
    });
    expect(stageComplete()).toBe(true);
  });

  it('is false when there are no active tasks at all', () => {
    DEPTS.forEach((d) => {
      d.later = false;
      d.tasks = [];
    });
    expect(stageComplete()).toBe(false);
  });
});

describe('currentStageProgress', () => {
  const snap = DEPTS.map((d) => ({ tasks: d.tasks, later: d.later }));
  const task = (done: boolean): Task => ({ t: 'x', done }) as Task;
  afterEach(() => {
    DEPTS.forEach((d, i) => {
      d.tasks = snap[i].tasks;
      d.later = snap[i].later;
    });
  });

  it('is the done-fraction of active (non-later) tasks', () => {
    DEPTS.forEach((d) => {
      d.later = false;
      d.tasks = [task(true), task(false)];
    });
    const p = currentStageProgress();
    expect(p.pct).toBe(50);
  });

  it('excludes dormant "later" departments', () => {
    DEPTS.forEach((d, i) => {
      d.later = i > 0; // only the first dept is active
      d.tasks = i === 0 ? [task(true), task(true)] : [task(false)];
    });
    expect(currentStageProgress()).toMatchObject({ done: 2, total: 2, pct: 100 });
  });

  it('is 0% (not NaN) with no active tasks', () => {
    DEPTS.forEach((d) => {
      d.later = true;
      d.tasks = [];
    });
    expect(currentStageProgress().pct).toBe(0);
  });

  it('never reads 100% while a task is still open (200/201 rounds to 99, not 100)', () => {
    DEPTS.forEach((d, i) => {
      d.later = i > 0;
      d.tasks = [];
    });
    DEPTS[0].tasks = [...Array(200)].map(() => task(true)).concat(task(false)); // 200/201
    expect(currentStageProgress()).toMatchObject({ done: 200, total: 201, pct: 99 });
  });
});

describe('nextPhaseName', () => {
  const phaseNames = PHASES.map((p) => p.name);

  it('returns the phase after the current one, or null on the last, for every stage', () => {
    for (const stage of OB_STAGES) {
      const cur = currentPhaseName(stage);
      const i = phaseNames.indexOf(cur);
      const expected = i >= 0 && i < phaseNames.length - 1 ? phaseNames[i + 1] : null;
      expect(nextPhaseName(stage)).toBe(expected);
    }
  });

  it('the last onboarding stage is on the last phase → null (no bogus "next")', () => {
    expect(nextPhaseName(OB_STAGES[OB_STAGES.length - 1])).toBeNull();
  });

  it('an early stage has a real next phase (not null)', () => {
    expect(nextPhaseName(OB_STAGES[0])).not.toBeNull();
  });
});
