import { describe, it, expect } from 'vitest';
import { newRun, reduceRun, isFinished } from './liveRun';
import type { RunStep } from './runTrace';

const base = () =>
  newRun({
    deptK: 'mkt',
    taskTitle: 'Landing site',
    deptName: 'Marketing',
    type: 'doc',
    startedAt: 1000,
  });

const briefStep: RunStep = {
  phase: 'brief',
  label: 'Read your Business Brief',
  source: 'Brief',
  evidence: [{ quote: 'A macOS companion', source: 'your one-liner' }],
};

describe('newRun', () => {
  it('starts running with nothing done', () => {
    const r = base();
    expect(r.status).toBe('running');
    expect(r.steps).toEqual([]);
    expect(r.activePhase).toBeNull();
    expect(r.credits).toBeNull();
    expect(isFinished(r)).toBe(false);
  });
});

describe('reduceRun', () => {
  it('records a completed step and marks its phase done', () => {
    const r = reduceRun(base(), { type: 'step', step: briefStep }, 1200);
    expect(r.steps).toEqual([briefStep]);
    expect(r.donePhases).toEqual(['brief']);
  });

  it('tracks the active phase', () => {
    const r = reduceRun(base(), { type: 'active', phase: 'generate' }, 1200);
    expect(r.activePhase).toBe('generate');
  });

  it('clears the active phase once that phase completes', () => {
    let r = reduceRun(base(), { type: 'active', phase: 'brief' }, 1100);
    r = reduceRun(r, { type: 'step', step: briefStep }, 1200);
    expect(r.activePhase).toBeNull();
  });

  it('keeps a different active phase when another completes', () => {
    let r = reduceRun(base(), { type: 'active', phase: 'generate' }, 1100);
    r = reduceRun(r, { type: 'step', step: briefStep }, 1200);
    expect(r.activePhase).toBe('generate');
  });

  it('records the real credit charge', () => {
    const r = reduceRun(base(), { type: 'usage', credits: 4 }, 1300);
    expect(r.credits).toBe(4);
  });

  it('finishes on result, stamping the end time and clearing the spinner', () => {
    const r = reduceRun(base(), { type: 'result', text: 'the page' }, 5000);
    expect(r.status).toBe('done');
    expect(r.result).toEqual({ text: 'the page' });
    expect(r.endedAt).toBe(5000);
    expect(r.activePhase).toBeNull();
    expect(isFinished(r)).toBe(true);
  });

  it('keeps completed steps when the run fails', () => {
    let r = reduceRun(base(), { type: 'step', step: briefStep }, 1200);
    r = reduceRun(r, { type: 'active', phase: 'generate' }, 1300);
    r = reduceRun(r, { type: 'error', code: 'generation_failed' }, 4000);
    expect(r.status).toBe('failed');
    expect(r.errorCode).toBe('generation_failed');
    expect(r.steps).toEqual([briefStep]);
    expect(r.activePhase).toBeNull();
    expect(isFinished(r)).toBe(true);
  });

  it('distinguishes a usage limit from a generation failure', () => {
    const r = reduceRun(base(), { type: 'error', code: 'rate_limited' }, 4000);
    expect(r.status).toBe('limited');
  });

  it('ignores events after the run has finished', () => {
    const done = reduceRun(base(), { type: 'result', text: 'x' }, 5000);
    const after = reduceRun(done, { type: 'error', code: 'generation_failed' }, 6000);
    expect(after).toBe(done);
  });
});
