import { describe, it, expect } from 'vitest';
import { formatRecallBlock } from './secondBrainRecall';

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
    expect(block).toContain('- API v1: Shipped the API.');
  });
});
