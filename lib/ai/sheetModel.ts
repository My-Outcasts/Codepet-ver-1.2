// Pure logic for the Finance pricing model (`sheet`). Kept out of the viewer and
// the server route so it's unit-testable and shared. Two guarantees enforced here:
//   1. The 4 inputs are ALWAYS [price, waitlist, conversion, churn] in that order,
//      with the roles/labels/units fixed in code — byte only fills values/ranges.
//      SheetViewer reads inputs by index, so the order is load-bearing.
//   2. The model math can never return a non-finite number (churn is floored so
//      `price / churn` and `1 / churn` never blow up). sheetModel.test.ts checks this.

/** A finite number, or the fallback if x isn't usable. */
function fin(x: unknown, fallback: number): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : fallback;
}

export interface SheetInput {
  k: string;
  label: string;
  val: number;
  min: number;
  max: number;
  step: number;
  pre?: string;
  suf?: string;
}

// The fixed input contract. `key` maps to byte's payload field; everything else
// (label, unit, order, floor) is ours. `floor` keeps a value from going low
// enough to break the model (churn ≥ 1 ⇒ churn/100 ≥ 0.01).
const SHEET_INPUT_META = [
  {
    k: 'price',
    key: 'price',
    label: 'Pro price / mo',
    pre: '$',
    floor: 1,
    seed: { val: 12, min: 6, max: 20, step: 1 },
  },
  {
    k: 'wl',
    key: 'waitlist',
    label: 'Waitlist size',
    floor: 0,
    seed: { val: 1504, min: 200, max: 5000, step: 1 },
  },
  {
    k: 'conv',
    key: 'conversion',
    label: 'Waitlist → paid',
    suf: '%',
    floor: 0,
    seed: { val: 8, min: 1, max: 25, step: 1 },
  },
  {
    k: 'churn',
    key: 'churn',
    label: 'Monthly churn',
    suf: '%',
    floor: 1,
    seed: { val: 5, min: 1, max: 15, step: 1 },
  },
] as const;

/**
 * Rebuild the fixed 4-input array from byte's payload, clamping every field so the
 * result is always renderable and safe: min ≥ floor, max ≥ min, val within [min,max],
 * step ≥ 1. Any missing/garbage field falls back to that input's seed. Returns null
 * only if the payload isn't an object at all (caller keeps the seed).
 */
export function buildSheetInputs(payload: unknown): SheetInput[] | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  return SHEET_INPUT_META.map((meta) => {
    const raw = (p[meta.key] ?? {}) as Record<string, unknown>;
    const seed = meta.seed;
    let min = Math.max(meta.floor, fin(raw.min, seed.min));
    let max = fin(raw.max, seed.max);
    if (max < min) {
      // byte gave an inverted/degenerate range — fall back to the seed range.
      min = Math.max(meta.floor, seed.min);
      max = seed.max;
    }
    const step = Math.max(1, fin(raw.step, seed.step));
    const val = Math.min(max, Math.max(min, fin(raw.val, seed.val)));
    const input: SheetInput = { k: meta.k, label: meta.label, val, min, max, step };
    if ('pre' in meta && meta.pre) input.pre = meta.pre;
    if ('suf' in meta && meta.suf) input.suf = meta.suf;
    return input;
  });
}

export interface SheetModel {
  paid: number;
  mrr: number;
  arr: number;
  ltv: number;
  life: number;
  breakeven: number;
}

/**
 * The projection SheetViewer renders. `vals` is the live slider state, in the fixed
 * order [price, waitlist, conversion%, churn%]. churn and price are floored so no
 * division ever produces Infinity/NaN.
 */
export function computeSheetModel(vals: number[]): SheetModel {
  const price = Math.max(1, fin(vals[0], 12));
  const wl = fin(vals[1], 1504);
  const conv = fin(vals[2], 8) / 100;
  const churn = Math.max(0.01, fin(vals[3], 5) / 100);
  const paid = Math.round(wl * conv);
  const mrr = paid * price;
  return {
    paid,
    mrr,
    arr: mrr * 12,
    ltv: Math.round(price / churn),
    life: Math.round(1 / churn),
    breakeven: Math.ceil(2500 / price),
  };
}
