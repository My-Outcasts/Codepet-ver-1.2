import { describe, it, expect } from 'vitest';
import { briefStep, priorWorkStep, generateStep } from './runTrace';

describe('briefStep', () => {
  it('quotes only the brief fields that are actually present', () => {
    const step = briefStep({
      oneLiner: 'A macOS companion that runs your company',
      audience: 'Solo technical founders',
    });
    expect(step).not.toBeNull();
    expect(step!.label).toBe('Read your Business Brief');
    expect(step!.source).toBe('Brief');
    expect(step!.evidence).toEqual([
      { quote: 'A macOS companion that runs your company', source: 'your one-liner' },
      { quote: 'Solo technical founders', source: 'who it’s for' },
    ]);
  });

  it('returns null when the brief has nothing groundable', () => {
    expect(briefStep({})).toBeNull();
    expect(briefStep(undefined)).toBeNull();
  });

  it('never invents evidence for a blank field', () => {
    const step = briefStep({ oneLiner: 'Ship faster', audience: '   ' });
    expect(step!.evidence).toEqual([{ quote: 'Ship faster', source: 'your one-liner' }]);
  });

  it('truncates a long field instead of dumping it', () => {
    const step = briefStep({ notes: 'x'.repeat(300) });
    expect(step!.evidence[0].quote.length).toBeLessThanOrEqual(160);
    expect(step!.evidence[0].quote.endsWith('…')).toBe(true);
  });
});

describe('priorWorkStep', () => {
  it('names the real deliverables that were selected', () => {
    const step = priorWorkStep([
      { title: 'Brand & voice', dept: 'Marketing', k: 'mkt', type: 'doc', out: 'warm, plain' },
      { title: 'Pricing model', dept: 'Finance', k: 'fin', type: 'sheet', out: '$8-15' },
    ]);
    expect(step!.label).toBe('Pulled 2 pieces of your approved work');
    expect(step!.source).toBe('Library');
    expect(step!.evidence).toEqual([
      { quote: 'Brand & voice', source: 'Marketing · doc' },
      { quote: 'Pricing model', source: 'Finance · sheet' },
    ]);
  });

  it('uses the singular when one item was selected', () => {
    const step = priorWorkStep([
      { title: 'Brand & voice', dept: 'Marketing', k: 'mkt', type: 'doc', out: 'x' },
    ]);
    expect(step!.label).toBe('Pulled 1 piece of your approved work');
  });

  it('returns null when nothing was selected, rather than claiming a lookup', () => {
    expect(priorWorkStep([])).toBeNull();
  });
});

describe('generateStep', () => {
  it('names the department that is writing', () => {
    expect(generateStep('doc', 'Marketing').label).toBe('Writing the Marketing deliverable');
  });

  it('falls back to a plain label with no department', () => {
    expect(generateStep('doc', undefined).label).toBe('Writing the deliverable');
  });
});
