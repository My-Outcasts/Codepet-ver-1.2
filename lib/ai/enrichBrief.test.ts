import { describe, it, expect } from 'vitest';
import {
  hasEnrichableSignal,
  buildEnrichPrompt,
  mergeEnrichment,
  type BriefEnrichment,
} from './enrichBrief';

describe('hasEnrichableSignal', () => {
  it('is true with a one-liner or notes, false without', () => {
    expect(hasEnrichableSignal({ oneLiner: 'a companion' })).toBe(true);
    expect(hasEnrichableSignal({ notes: 'pasted readme' })).toBe(true);
    expect(hasEnrichableSignal({ projectName: 'Codepet', stage: 'Private beta' })).toBe(false);
    expect(hasEnrichableSignal({ oneLiner: '   ' })).toBe(false);
  });
});

describe('buildEnrichPrompt', () => {
  it('includes the founder inputs and forbids invention', () => {
    const p = buildEnrichPrompt({
      projectName: 'Codepet',
      oneLiner: 'a macOS companion for founders',
      notes: 'post-session recap',
    });
    expect(p).toContain('Codepet');
    expect(p).toContain('a macOS companion for founders');
    expect(p).toContain('post-session recap');
    expect(p).toContain('do not invent');
  });

  it('caps very long notes', () => {
    const p = buildEnrichPrompt({ projectName: 'X', notes: 'z'.repeat(5000) });
    expect(p.length).toBeLessThan(3000);
  });
});

describe('mergeEnrichment', () => {
  const enrichment: BriefEnrichment = {
    summary: 'A macOS companion that recaps your coding sessions.',
    audience: 'solo founders shipping with AI',
    categories: ['macOS app', 'dev tool'],
  };

  it("fills gaps but never overrides the founder's own audience/categories", () => {
    const out = mergeEnrichment(
      { projectName: 'Codepet', audience: 'roommates', categories: ['SaaS'] },
      enrichment,
    );
    expect(out.audience).toBe('roommates'); // founder's stays
    expect(out.categories).toEqual(['SaaS']); // founder's stays
    expect(out.summary).toBe('A macOS companion that recaps your coding sessions.');
  });

  it('fills audience + categories when the founder left them blank', () => {
    const out = mergeEnrichment({ projectName: 'Codepet', oneLiner: 'x' }, enrichment);
    expect(out.audience).toBe('solo founders shipping with AI');
    expect(out.categories).toEqual(['macOS app', 'dev tool']);
    expect(out.summary).toContain('recaps your coding sessions');
  });

  it('caps categories at 4 and drops empties', () => {
    const out = mergeEnrichment(
      { projectName: 'X' },
      { summary: 's', audience: '', categories: ['a', '', 'b', 'c', 'd', 'e'] },
    );
    expect(out.categories).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps a prior summary when enrichment returns none', () => {
    const out = mergeEnrichment(
      { projectName: 'X', summary: 'existing' },
      { summary: '', audience: '', categories: [] },
    );
    expect(out.summary).toBe('existing');
  });
});
