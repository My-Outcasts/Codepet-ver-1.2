import { describe, it, expect } from 'vitest';
import { sanitizeRepoName } from './repoName';

describe('sanitizeRepoName', () => {
  it('accepts a valid name (trimmed)', () => {
    expect(sanitizeRepoName('  my-app_2.0  ')).toBe('my-app_2.0');
    expect(sanitizeRepoName('Landing')).toBe('Landing');
  });
  it('rejects blank / whitespace', () => {
    expect(sanitizeRepoName('')).toBeNull();
    expect(sanitizeRepoName('   ')).toBeNull();
  });
  it('rejects bad characters and traversal-ish input', () => {
    for (const n of ['a b', 'a/b', '../x', 'a\\b', 'name!', 'a@b', 'x'.repeat(101)]) {
      expect(sanitizeRepoName(n)).toBeNull();
    }
  });
  it('rejects non-strings', () => {
    expect(sanitizeRepoName(null)).toBeNull();
    expect(sanitizeRepoName(42)).toBeNull();
  });
});
