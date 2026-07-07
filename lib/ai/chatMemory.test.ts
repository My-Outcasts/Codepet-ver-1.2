import { describe, it, expect } from 'vitest';
import { coerceMemory, newOrChanged, REMEMBER_FACT_SCHEMA } from './chatMemory';
import type { DecisionEntry } from './projectModel';

describe('coerceMemory', () => {
  it('coerces valid facts and stamps source=chat', () => {
    const out = coerceMemory({
      facts: [{ topic: 'Traction', statement: '~300 on the waitlist' }],
    });
    expect(out).toEqual([{ topic: 'traction', statement: '~300 on the waitlist', source: 'chat' }]);
  });

  it('drops items missing a topic or statement', () => {
    const out = coerceMemory({
      facts: [
        { topic: 'goal', statement: '' },
        { topic: '', statement: 'x' },
        { topic: 'pricing', statement: 'Pro is $12/mo' },
      ],
    });
    expect(out).toEqual([{ topic: 'pricing', statement: 'Pro is $12/mo', source: 'chat' }]);
  });

  it('returns [] for malformed / empty input', () => {
    expect(coerceMemory(null)).toEqual([]);
    expect(coerceMemory({})).toEqual([]);
    expect(coerceMemory({ facts: 'nope' })).toEqual([]);
  });

  it('clips overlong topic/statement', () => {
    const out = coerceMemory({ facts: [{ topic: 'x'.repeat(80), statement: 'y'.repeat(2000) }] });
    expect(out[0].topic.length).toBeLessThanOrEqual(40);
    expect(out[0].statement.length).toBeLessThanOrEqual(600);
  });
});

describe('newOrChanged', () => {
  const existing: DecisionEntry[] = [
    { topic: 'pricing', statement: 'Pro tier is $12/mo', updatedAt: 1 },
    { topic: 'traction', statement: '~200 on the waitlist', updatedAt: 1 },
  ];

  it('reports a brand-new topic', () => {
    const out = newOrChanged(existing, [{ topic: 'goal', statement: 'Ship the beta' }]);
    expect(out).toEqual([{ topic: 'goal', statement: 'Ship the beta' }]);
  });

  it('reports a changed statement on an existing topic', () => {
    const out = newOrChanged(existing, [{ topic: 'traction', statement: '~300 on the waitlist' }]);
    expect(out).toEqual([{ topic: 'traction', statement: '~300 on the waitlist' }]);
  });

  it('drops an unchanged repeat', () => {
    const out = newOrChanged(existing, [{ topic: 'pricing', statement: 'Pro tier is $12/mo' }]);
    expect(out).toEqual([]);
  });

  it('de-dups repeated topics within one message', () => {
    const out = newOrChanged(existing, [
      { topic: 'goal', statement: 'first' },
      { topic: 'goal', statement: 'second' },
    ]);
    expect(out).toHaveLength(1);
  });
});

describe('REMEMBER_FACT_SCHEMA', () => {
  it('is a strict object schema with a required facts array of {topic, statement}', () => {
    const props = REMEMBER_FACT_SCHEMA.properties as Record<string, { items?: unknown }>;
    expect((REMEMBER_FACT_SCHEMA.required as string[]).includes('facts')).toBe(true);
    const item = props.facts.items as { additionalProperties: boolean; required: string[] };
    expect(item.additionalProperties).toBe(false);
    expect(item.required).toEqual(['topic', 'statement']);
  });
});
