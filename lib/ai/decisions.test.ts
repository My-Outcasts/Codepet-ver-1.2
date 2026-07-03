import { describe, it, expect } from 'vitest';
import { buildExtractPrompt, mergeDecisions, type ExtractedDecision } from './decisions';
import { MAX_DECISIONS, type DecisionEntry } from './projectModel';

const NOW = 1_000_000;

describe('buildExtractPrompt', () => {
  const deliverable = {
    title: 'Pricing model',
    dept: 'Finance',
    type: 'sheet',
    out: 'Plus is $4/mo.',
  };

  it('lists existing decisions and the deliverable', () => {
    const p = buildExtractPrompt(deliverable, [{ topic: 'naming', statement: 'Called Tallytab' }]);
    expect(p).toContain('- naming: Called Tallytab');
    expect(p).toContain('Title: Pricing model');
    expect(p).toContain('Plus is $4/mo.');
  });

  it('shows "(none yet)" when there are no existing decisions', () => {
    expect(buildExtractPrompt(deliverable, [])).toContain('(none yet)');
  });

  it('caps and collapses whitespace in the deliverable text', () => {
    const p = buildExtractPrompt({ ...deliverable, out: 'a  b\n\nc '.repeat(600) }, []);
    const body = p.split('---')[1];
    expect(body.length).toBeLessThanOrEqual(2010); // 2000 cap + framing newlines
    expect(body).not.toContain('  ');
  });
});

describe('mergeDecisions', () => {
  const existing: DecisionEntry[] = [
    { topic: 'naming', statement: 'Called Tallytab', updatedAt: 1 },
    { topic: 'pricing', statement: 'Plus is $3/mo', updatedAt: 2 },
  ];

  it('adds a new-topic decision and stamps updatedAt', () => {
    const out = mergeDecisions(existing, [{ topic: 'audience', statement: 'roommates' }], NOW);
    const added = out.find((d) => d.topic === 'audience');
    expect(added).toEqual({
      topic: 'audience',
      statement: 'roommates',
      source: undefined,
      updatedAt: NOW,
    });
    expect(out).toHaveLength(3);
  });

  it('replaces an existing decision on the same topic (case-insensitive)', () => {
    const out = mergeDecisions(existing, [{ topic: 'Pricing', statement: 'Plus is $4/mo' }], NOW);
    const pricing = out.filter((d) => d.topic.toLowerCase() === 'pricing');
    expect(pricing).toHaveLength(1);
    expect(pricing[0].statement).toBe('Plus is $4/mo');
    expect(pricing[0].updatedAt).toBe(NOW);
  });

  it('preserves untouched existing decisions', () => {
    const out = mergeDecisions(existing, [{ topic: 'pricing', statement: 'Plus is $4/mo' }], NOW);
    expect(out.find((d) => d.topic === 'naming')?.statement).toBe('Called Tallytab');
  });

  it('skips extracted entries missing topic or statement', () => {
    const bad: ExtractedDecision[] = [
      { topic: '', statement: 's' },
      { topic: 't', statement: '  ' },
    ];
    expect(mergeDecisions([], bad, NOW)).toEqual([]);
  });

  it('carries source through, trimmed', () => {
    const out = mergeDecisions(
      [],
      [{ topic: 't', statement: 's', source: ' Finance / Pricing ' }],
      NOW,
    );
    expect(out[0].source).toBe('Finance / Pricing');
  });

  it('caps at MAX_DECISIONS, evicting the oldest', () => {
    const many: DecisionEntry[] = Array.from({ length: MAX_DECISIONS }, (_, i) => ({
      topic: `t${i}`,
      statement: 's',
      updatedAt: i, // t0 oldest
    }));
    // Add one new topic → over cap by 1; the oldest (t0) is evicted, the new one kept.
    const out = mergeDecisions(many, [{ topic: 'fresh', statement: 'new' }], NOW);
    expect(out).toHaveLength(MAX_DECISIONS);
    expect(out.some((d) => d.topic === 'fresh')).toBe(true);
    expect(out.some((d) => d.topic === 't0')).toBe(false);
  });
});
