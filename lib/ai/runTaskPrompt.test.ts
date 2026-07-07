import { describe, it, expect } from 'vitest';
import { BYTE_SYSTEM, composeRunSystem, buildTaskPrompt, type TaskFields } from './runTaskPrompt';

const CONTEXT = 'Fernweh is a slow-travel booking app for remote workers; 1,200 waitlist signups.';
const base: TaskFields = { taskTitle: 'Draft the launch email' };

describe('composeRunSystem', () => {
  it('carries byte’s contract and the company context in the cached system block', () => {
    const sys = composeRunSystem(CONTEXT);
    expect(sys.startsWith(BYTE_SYSTEM)).toBe(true);
    expect(sys).toContain(CONTEXT);
  });
});

describe('buildTaskPrompt — cache safety', () => {
  it('does NOT put the company context in the per-task prompt (would bust the cache)', () => {
    // The whole point of phase-2: context lives in the system, so the volatile user
    // prompt must never contain it — otherwise every call re-caches the prefix.
    const prompt = buildTaskPrompt({
      instruction: 'Write the email.',
      priorWork: '',
      fields: base,
    });
    expect(prompt).not.toContain(CONTEXT);
    expect(prompt).not.toContain('The founder’s company:');
    expect(prompt).not.toMatch(/Company context:/);
  });

  it('includes the task, its instruction, and prior work', () => {
    const prompt = buildTaskPrompt({
      instruction: 'Write a real, formatted email.',
      priorWork: 'PRIOR: the approved positioning doc says “calm, not cheap”.',
      fields: { ...base, taskHint: 'a warm launch-day email' },
    });
    expect(prompt).toContain('Task: Draft the launch email');
    expect(prompt).toContain('Intended deliverable: a warm launch-day email');
    expect(prompt).toContain('Write a real, formatted email.');
    expect(prompt).toContain('PRIOR: the approved positioning doc');
  });

  it('omits the prior-work block entirely when there is none', () => {
    const prompt = buildTaskPrompt({ instruction: 'x', priorWork: '', fields: base });
    expect(prompt).not.toContain('PRIOR');
    expect(prompt).toContain('Produce the deliverable now.');
  });

  it('switches to a revise pass when given a note + current draft', () => {
    const prompt = buildTaskPrompt({
      instruction: 'x',
      priorWork: '',
      fields: { ...base, reviseNote: 'make it shorter', current: 'Dear traveler, ...' },
    });
    expect(prompt).toContain('You previously produced this draft:');
    expect(prompt).toContain('Revise it to address this feedback: make it shorter');
    expect(prompt).toContain('Dear traveler, ...');
    expect(prompt).not.toContain('Produce the deliverable now.');
  });

  it('includes the department line when a deptName is given', () => {
    const prompt = buildTaskPrompt({
      instruction: 'x',
      priorWork: '',
      fields: { ...base, deptName: 'Marketing' },
    });
    expect(prompt).toContain('Department: Marketing');
  });
});
