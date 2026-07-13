import { describe, it, expect } from 'vitest';
import { coerceTaskHelp } from './taskHelp';

describe('coerceTaskHelp', () => {
  it('keeps a well-formed guide + capture', () => {
    const r = coerceTaskHelp({
      guide: {
        call: 'Open a business account so revenue is separate.',
        steps: [{ h: 'Pick a bank', p: 'Compare fees.' }],
        options: [{ name: 'Mercury', why: 'No monthly fee.' }],
        est: '~15 min',
      },
      capture: { fields: [{ key: 'bank', label: 'Which bank?' }], note: 'Verify before acting.' },
    });
    expect(r?.guide.call).toContain('business account');
    expect(r?.guide.steps).toHaveLength(1);
    expect(r?.capture?.fields[0].key).toBe('bank');
  });

  it('returns null when there is nothing useful to show', () => {
    expect(coerceTaskHelp({})).toBeNull();
    expect(coerceTaskHelp({ guide: { call: '', steps: [] } })).toBeNull();
    expect(coerceTaskHelp(null)).toBeNull();
  });

  it('drops capture fields without a key/label and omits empty capture', () => {
    const r = coerceTaskHelp({
      guide: { call: 'Do it.', steps: [] },
      capture: { fields: [{ key: '', label: 'x' }, { label: 'no key' }] },
    });
    expect(r?.capture).toBeUndefined();
  });

  it('caps runaway lists (steps ≤ 6, options ≤ 4, fields ≤ 3)', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => i);
    const r = coerceTaskHelp({
      guide: {
        call: 'x',
        steps: many(10).map((i) => ({ h: `s${i}`, p: 'p' })),
        options: many(10).map((i) => ({ name: `o${i}`, why: 'w' })),
      },
      capture: { fields: many(10).map((i) => ({ key: `k${i}`, label: `l${i}` })) },
    });
    expect(r?.guide.steps.length).toBe(6);
    expect(r?.guide.options?.length).toBe(4);
    expect(r?.capture?.fields.length).toBe(3);
  });
});
