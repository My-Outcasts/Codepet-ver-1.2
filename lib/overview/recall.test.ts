import { describe, it, expect } from 'vitest';
import { cosine, topK, formatRecallBlock } from './recall';

describe('cosine', () => {
  it('is 1 for identical, ~0 for orthogonal', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });
  it('is 0 when a vector is zero-length', () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe('topK', () => {
  const items = [
    { title: 'a', summary: 'a', vec: [1, 0] },
    { title: 'b', summary: 'b', vec: [0.9, 0.1] },
    { title: 'c', summary: 'c', vec: [0, 1] },
    { title: 'd', summary: 'd' }, // no vec — skipped
  ];
  it('ranks by cosine desc and limits to k', () => {
    const hits = topK([1, 0], items, 2);
    expect(hits.map((h) => h.title)).toEqual(['a', 'b']);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });
  it('skips items without a vector', () => {
    const hits = topK([1, 0], items, 10);
    expect(hits.find((h) => h.title === 'd')).toBeUndefined();
  });
});

describe('formatRecallBlock', () => {
  it('is empty when there are no hits', () => {
    expect(formatRecallBlock([])).toBe('');
  });
  it('lists title: summary lines under a labeled header', () => {
    const block = formatRecallBlock([
      { title: 'Pricing', summary: 'Charge $9/mo.' },
      { title: 'API v1', summary: 'Shipped the API.' },
    ]);
    expect(block).toContain('Second Brain');
    expect(block).toContain('- Pricing: Charge $9/mo.');
  });
});
