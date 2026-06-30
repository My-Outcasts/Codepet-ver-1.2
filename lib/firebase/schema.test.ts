import { describe, it, expect } from 'vitest';
import { paths } from './schema';

describe('Firestore path helpers', () => {
  it('builds user + company document paths', () => {
    expect(paths.user('abc')).toBe('users/abc');
    expect(paths.company('c1')).toBe('companies/c1');
  });
  it('nests department + library paths under their company', () => {
    expect(paths.department('c1', 'eng')).toBe('companies/c1/departments/eng');
    expect(paths.libraryItem('c1', 'item9')).toBe('companies/c1/library/item9');
  });
  it('collection paths have an odd segment count, doc paths even', () => {
    const seg = (p: string) => p.split('/').length;
    expect(seg(paths.companies()) % 2).toBe(1); // collection
    expect(seg(paths.company('c1')) % 2).toBe(0); // document
    expect(seg(paths.departments('c1')) % 2).toBe(1); // collection
    expect(seg(paths.department('c1', 'eng')) % 2).toBe(0); // document
  });
});
