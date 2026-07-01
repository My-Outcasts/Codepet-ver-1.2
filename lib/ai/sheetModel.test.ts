import { describe, it, expect } from 'vitest';
import { buildSheetInputs, computeSheetModel } from './sheetModel';

describe('buildSheetInputs', () => {
  it('rebuilds the fixed 4-input contract in order with units', () => {
    const inputs = buildSheetInputs({
      price: { val: 15, min: 8, max: 30, step: 1 },
      waitlist: { val: 2000, min: 500, max: 8000, step: 50 },
      conversion: { val: 10, min: 1, max: 30, step: 1 },
      churn: { val: 4, min: 1, max: 12, step: 1 },
      summary: 'x',
    });
    expect(inputs?.map((i) => i.k)).toEqual(['price', 'wl', 'conv', 'churn']);
    expect(inputs?.[0]).toMatchObject({ val: 15, pre: '$' });
    expect(inputs?.[2]).toMatchObject({ suf: '%' });
    expect(inputs?.[3]).toMatchObject({ suf: '%' });
  });

  it('floors churn min at 1 so the model can never divide by zero', () => {
    const inputs = buildSheetInputs({
      price: { val: 12, min: 6, max: 20, step: 1 },
      waitlist: { val: 1000, min: 200, max: 5000, step: 1 },
      conversion: { val: 8, min: 1, max: 25, step: 1 },
      churn: { val: 0, min: 0, max: 15, step: 1 },
      summary: 'x',
    });
    const churn = inputs?.[3];
    expect(churn?.min).toBeGreaterThanOrEqual(1);
    expect(churn?.val).toBeGreaterThanOrEqual(1);
  });

  it('clamps val into range and falls back on an inverted range', () => {
    const inputs = buildSheetInputs({
      price: { val: 999, min: 6, max: 20, step: 1 }, // val above max → clamped
      waitlist: { val: 1000, min: 5000, max: 200, step: 1 }, // inverted → seed range
      conversion: { val: 8, min: 1, max: 25, step: 1 },
      churn: { val: 5, min: 1, max: 15, step: 1 },
      summary: 'x',
    });
    expect(inputs?.[0].val).toBe(20);
    expect(inputs?.[1].min).toBeLessThanOrEqual(inputs![1].max);
  });

  it('falls back to seeds for missing/garbage fields, and null for a non-object', () => {
    const inputs = buildSheetInputs({ summary: 'x' });
    expect(inputs?.[0]).toMatchObject({ k: 'price', val: 12 });
    expect(buildSheetInputs(null)).toBeNull();
    expect(buildSheetInputs('nope')).toBeNull();
  });
});

describe('computeSheetModel', () => {
  it('computes the projection at sane inputs', () => {
    const m = computeSheetModel([12, 1000, 8, 5]);
    expect(m.paid).toBe(80); // 1000 * 0.08
    expect(m.mrr).toBe(960); // 80 * 12
    expect(m.arr).toBe(11520);
  });

  // The core guarantee: no live-generated slider value can ever produce Infinity/NaN.
  it.each([
    [0, 0, 0, 0],
    [12, 1000, 8, 0], // churn 0
    [0, 0, 0, 0.0001],
    [Number.NaN, Number.NaN, Number.NaN, Number.NaN],
    [-5, -100, -3, -9],
  ])('never returns a non-finite number for [%s,%s,%s,%s]', (...vals) => {
    const m = computeSheetModel(vals as number[]);
    for (const v of Object.values(m)) expect(Number.isFinite(v)).toBe(true);
  });
});
