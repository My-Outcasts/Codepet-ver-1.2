import { describe, it, expect } from 'vitest';
import { coversAllDepartments } from './scaffold';
import { DEPTS_SEED } from '../data';

describe('coversAllDepartments', () => {
  const allKeys = DEPTS_SEED.map((d) => ({ k: d.k }));
  it('true when every department key is present', () => {
    expect(coversAllDepartments(allKeys)).toBe(true);
  });
  it('false when any department key is missing', () => {
    expect(coversAllDepartments(allKeys.slice(1))).toBe(false);
  });
  it('false for an empty array', () => {
    expect(coversAllDepartments([])).toBe(false);
  });
  it('extra/unknown keys still pass as long as all real ones are present', () => {
    expect(coversAllDepartments([...allKeys, { k: 'bogus' }])).toBe(true);
  });
});
