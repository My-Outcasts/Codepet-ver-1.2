import { describe, it, expect } from 'vitest';
import { researchPrompt, parseResearchOverview } from './researchOverview';

describe('researchPrompt', () => {
  it('embeds the company context', () => {
    const p = researchPrompt('The company is Acme. It sells rockets.');
    expect(p).toContain('The company is Acme. It sells rockets.');
    expect(p.toLowerCase()).toContain('research');
  });
});

describe('parseResearchOverview', () => {
  const good = {
    summary: 'Acme sits in a growing market.',
    findings: ['Market is growing 12% a year.', 'Two big incumbents dominate.'],
    sources: [
      { name: 'Crunchbase', url: 'https://www.crunchbase.com', why: 'Track competitor funding.' },
    ],
    nextSteps: ['Interview 5 target users.', 'Draft a positioning one-pager.'],
  };

  it('accepts a well-formed overview', () => {
    const o = parseResearchOverview(good);
    expect(o).not.toBeNull();
    expect(o!.summary).toBe(good.summary);
    expect(o!.findings).toHaveLength(2);
    expect(o!.sources[0].name).toBe('Crunchbase');
    expect(o!.nextSteps).toHaveLength(2);
  });

  it('rejects a missing or empty summary', () => {
    expect(parseResearchOverview({ ...good, summary: '' })).toBeNull();
    expect(parseResearchOverview({ ...good, summary: undefined })).toBeNull();
    expect(parseResearchOverview(null)).toBeNull();
    expect(parseResearchOverview('text')).toBeNull();
  });

  it('drops malformed entries instead of failing the whole overview', () => {
    const o = parseResearchOverview({
      ...good,
      findings: ['ok', 42, ''],
      sources: [{ name: 'X', url: 'https://x.com', why: 'w' }, { name: 7 }, 'junk'],
      nextSteps: ['do it', null],
    });
    expect(o).not.toBeNull();
    expect(o!.findings).toEqual(['ok']);
    expect(o!.sources).toHaveLength(1);
    expect(o!.nextSteps).toEqual(['do it']);
  });

  it('clears non-http(s) source urls but keeps the source', () => {
    const o = parseResearchOverview({
      ...good,
      sources: [{ name: 'Sketchy', url: 'javascript:alert(1)', why: 'nope' }],
    });
    expect(o!.sources[0].url).toBe('');
    expect(o!.sources[0].name).toBe('Sketchy');
  });

  it('caps list lengths', () => {
    const many = Array.from({ length: 12 }, (_, i) => `item ${i}`);
    const o = parseResearchOverview({ ...good, findings: many, nextSteps: many });
    expect(o!.findings.length).toBeLessThanOrEqual(5);
    expect(o!.nextSteps.length).toBeLessThanOrEqual(3);
  });
});
