import { describe, it, expect } from 'vitest';
import { unlockedKeys } from './growth';
import type { Dept } from '../data';

const dept = (k: string, later: boolean): Dept => ({ k, later }) as unknown as Dept;

describe('unlockedKeys', () => {
  it('returns keys dormant-before and active-after, in order', () => {
    const before = new Set(['mkt', 'sales']);
    const after = [dept('design', false), dept('mkt', false), dept('sales', true)];
    // mkt was dormant→active (unlocked); sales still dormant; design was already active.
    expect(unlockedKeys(before, after)).toEqual(['mkt']);
  });
  it('excludes departments that were already active before', () => {
    const before = new Set<string>(); // nothing was dormant
    const after = [dept('design', false), dept('eng', false)];
    expect(unlockedKeys(before, after)).toEqual([]);
  });
  it('excludes departments still dormant after', () => {
    const before = new Set(['mkt']);
    const after = [dept('mkt', true)];
    expect(unlockedKeys(before, after)).toEqual([]);
  });
  it('empty when nothing changed; preserves DEPTS order for multiple unlocks', () => {
    expect(unlockedKeys(new Set(), [])).toEqual([]);
    const before = new Set(['mkt', 'sales', 'legal']);
    const after = [dept('sales', false), dept('mkt', false), dept('legal', true)];
    expect(unlockedKeys(before, after)).toEqual(['sales', 'mkt']); // after-array order
  });
});
