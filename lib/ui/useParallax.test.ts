import { describe, it, expect } from 'vitest';
import { clampNorm } from './useParallax';

describe('clampNorm', () => {
  it('maps the midpoint to 0', () => {
    expect(clampNorm(50, 0, 100)).toBe(0);
  });
  it('maps the ends to -1 and 1', () => {
    expect(clampNorm(0, 0, 100)).toBe(-1);
    expect(clampNorm(100, 0, 100)).toBe(1);
  });
  it('clamps beyond the range', () => {
    expect(clampNorm(150, 0, 100)).toBe(1);
    expect(clampNorm(-50, 0, 100)).toBe(-1);
  });
  it('returns 0 for a zero-width range', () => {
    expect(clampNorm(5, 5, 5)).toBe(0);
  });
});
