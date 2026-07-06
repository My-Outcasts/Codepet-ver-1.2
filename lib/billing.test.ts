import { describe, it, expect } from 'vitest';
import { usageMeter, canSendSupport } from './billing';

describe('usageMeter', () => {
  it('computes used / pct / label', () => {
    expect(usageMeter(12, 30)).toEqual({ used: 12, limit: 30, pct: 40, label: '12 of 30 runs' });
    expect(usageMeter(0, 30)).toEqual({ used: 0, limit: 30, pct: 0, label: '0 of 30 runs' });
  });
  it('clamps over-limit and negatives', () => {
    expect(usageMeter(45, 30).used).toBe(30);
    expect(usageMeter(45, 30).pct).toBe(100);
    expect(usageMeter(-3, 30).used).toBe(0);
  });
  it('handles a zero/invalid limit without NaN, clamping used too', () => {
    expect(usageMeter(5, 0)).toEqual({ used: 0, limit: 0, pct: 0, label: '0 of 0 runs' });
  });
  it('treats NaN n/limit as 0', () => {
    expect(usageMeter(NaN, 30).used).toBe(0);
    expect(usageMeter(12, NaN).limit).toBe(0);
    expect(usageMeter(12, NaN).pct).toBe(0);
  });
});

describe('canSendSupport', () => {
  it('requires a non-empty trimmed message', () => {
    expect(canSendSupport('')).toBe(false);
    expect(canSendSupport('   ')).toBe(false);
    expect(canSendSupport('help')).toBe(true);
  });
});
