import { describe, it, expect } from 'vitest';
import { toolkitUsedFor, appendTaskUse, usageReceipt, runLogWithToolkit } from './toolkitUse';
import type { LogStep } from '../helpers';

const env = {
  skills: [
    { n: 'Code review', s: 1, fits: ['build'] },
    { n: 'Changelog', s: 0, fits: ['build'] }, // off — excluded
    { n: 'Web research', s: 1, fits: ['post'] }, // wrong type — excluded
  ],
  connectors: [{ n: 'GitHub', s: 1, fits: ['build', 'site'] }],
};

describe('toolkitUsedFor', () => {
  it('returns on-items whose fits includes the type', () => {
    expect(toolkitUsedFor(env, 'build')).toEqual([
      { name: 'Code review', category: 'skills' },
      { name: 'GitHub', category: 'connectors' },
    ]);
  });
  it('excludes off items and non-fitting types', () => {
    expect(toolkitUsedFor(env, 'post')).toEqual([{ name: 'Web research', category: 'skills' }]);
    expect(toolkitUsedFor(env, 'sheet')).toEqual([]);
  });
});

describe('appendTaskUse', () => {
  it('appends, dedupes, and caps at 20', () => {
    expect(appendTaskUse(undefined, 'A')).toEqual(['A']);
    expect(appendTaskUse(['A'], 'A')).toEqual(['A']); // dedupe
    expect(appendTaskUse(['A'], 'B')).toEqual(['A', 'B']);
    const twenty = Array.from({ length: 20 }, (_, i) => `T${i}`);
    expect(appendTaskUse(twenty, 'NEW')).toHaveLength(20);
    expect(appendTaskUse(twenty, 'NEW').at(-1)).toBe('NEW');
    expect(appendTaskUse(twenty, 'NEW')[0]).toBe('T1'); // oldest dropped
  });
});

describe('usageReceipt', () => {
  it('formats count + last, singular/plural, null when empty', () => {
    expect(usageReceipt(undefined)).toBeNull();
    expect(usageReceipt([])).toBeNull();
    expect(usageReceipt(['Draft copy'])).toBe("Used in 1 task · last: 'Draft copy'");
    expect(usageReceipt(['A', 'Launch narrative'])).toBe(
      "Used in 2 tasks · last: 'Launch narrative'",
    );
  });
});

describe('runLogWithToolkit', () => {
  const base: LogStep[] = [{ t: 'Reading brief' }, { t: 'Writing the deliverable ↓' }];
  it('inserts a used-step per item before the last base step', () => {
    const out = runLogWithToolkit(base, [
      { name: 'Code review', category: 'skills' },
      { name: 'GitHub', category: 'connectors' },
    ]);
    expect(out.map((s) => s.t)).toEqual([
      'Reading brief',
      'Reviewed the work with the Code review skill',
      'Worked through your GitHub connection',
      'Writing the deliverable ↓',
    ]);
    out.slice(1, 3).forEach((s) => expect(s.ck).toBeUndefined());
  });
  it('returns base unchanged when nothing used', () => {
    expect(runLogWithToolkit(base, [])).toEqual(base);
  });
});
