import { describe, it, expect } from 'vitest';
import {
  detectGaps,
  mergeAnswer,
  buildDistillPrompt,
  QUESTION_FOR,
  GAP_ORDER,
  MAX_QUESTIONS,
  type Gap,
} from './enrichInterview';
import type { CompanyBrief } from '../firebase/schema';

describe('detectGaps', () => {
  it('returns all three gaps in priority order for an empty brief', () => {
    expect(detectGaps({})).toEqual(['goal', 'traction', 'problem']);
  });

  it('treats a null/undefined brief as fully empty', () => {
    expect(detectGaps(null)).toEqual([...GAP_ORDER].slice(0, MAX_QUESTIONS));
    expect(detectGaps(undefined)).toEqual(['goal', 'traction', 'problem']);
  });

  it('skips fields that are already filled', () => {
    expect(detectGaps({ goal: 'launch in 3 weeks' })).toEqual(['traction', 'problem']);
    expect(detectGaps({ goal: 'x', traction: 'y', problem: 'z' })).toEqual([]);
  });

  it('treats whitespace-only fields as empty', () => {
    expect(detectGaps({ goal: '   ', traction: '\n' })).toEqual(['goal', 'traction', 'problem']);
  });

  it('never asks more than MAX_QUESTIONS', () => {
    expect(detectGaps({}).length).toBeLessThanOrEqual(MAX_QUESTIONS);
  });
});

describe('QUESTION_FOR', () => {
  it('has an ask + why for every gap', () => {
    for (const g of GAP_ORDER) {
      expect(QUESTION_FOR[g].ask.length).toBeGreaterThan(0);
      expect(QUESTION_FOR[g].why.length).toBeGreaterThan(0);
    }
  });
});

describe('buildDistillPrompt', () => {
  it('embeds the question and the raw reply, and forbids invention', () => {
    const p = buildDistillPrompt('traction', '300 on the waitlist, launched last month');
    expect(p).toContain(QUESTION_FOR.traction.ask);
    expect(p).toContain('300 on the waitlist');
    expect(p).toMatch(/do not invent|Do NOT invent/i);
  });

  it('clips an overlong reply', () => {
    const huge = 'x'.repeat(5000);
    const p = buildDistillPrompt('goal', huge);
    expect(p.length).toBeLessThan(3000);
  });
});

describe('mergeAnswer', () => {
  it('fills an empty gap with the distilled value', () => {
    const out = mergeAnswer({ projectName: 'Codepet' }, 'goal', { value: 'Ship the macOS beta' });
    expect(out.goal).toBe('Ship the macOS beta');
  });

  it('is a no-op when the distill is empty (a skip / no-signal reply)', () => {
    const brief: CompanyBrief = { projectName: 'Codepet' };
    expect(mergeAnswer(brief, 'goal', { value: '' })).toEqual(brief);
    expect(mergeAnswer(brief, 'goal', { value: '   ' })).toEqual(brief);
  });

  it('never overrides an already-filled field', () => {
    const out = mergeAnswer({ goal: 'the founder typed this' }, 'goal', { value: 'byte override' });
    expect(out.goal).toBe('the founder typed this');
  });

  it('clips an overlong value', () => {
    const out = mergeAnswer({}, 'problem', { value: 'p'.repeat(2000) });
    expect((out.problem ?? '').length).toBeLessThanOrEqual(600);
  });

  it('does not mutate the input brief', () => {
    const brief: CompanyBrief = { projectName: 'Codepet' };
    mergeAnswer(brief, 'goal' as Gap, { value: 'new goal' });
    expect(brief.goal).toBeUndefined();
  });
});
