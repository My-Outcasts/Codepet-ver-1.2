import { describe, it, expect } from 'vitest';
import { repoInInstallation } from './repos';

const list = [
  { owner: 'acme', name: 'web' },
  { owner: 'acme', name: 'api' },
];

describe('repoInInstallation', () => {
  it('accepts a repo in the list (case-insensitive)', () => {
    expect(repoInInstallation(list, { owner: 'acme', name: 'web' })).toBe(true);
    expect(repoInInstallation(list, { owner: 'ACME', name: 'WEB' })).toBe(true);
  });
  it('rejects a repo not in the list', () => {
    expect(repoInInstallation(list, { owner: 'acme', name: 'secret' })).toBe(false);
    expect(repoInInstallation(list, { owner: 'evil', name: 'web' })).toBe(false);
  });
  it('rejects malformed targets', () => {
    expect(repoInInstallation(list, { owner: '', name: 'web' })).toBe(false);
    expect(repoInInstallation([], { owner: 'acme', name: 'web' })).toBe(false);
  });
});
