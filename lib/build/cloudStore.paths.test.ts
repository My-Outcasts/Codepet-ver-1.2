import { describe, it, expect } from 'vitest';
import { buildStoragePrefix, previewUrlFor } from './cloudStore';

describe('cloud store paths', () => {
  it('namespaces storage by build session (no companyId — the public preview route only has this)', () => {
    expect(buildStoragePrefix('b9')).toBe('builds/preview/b9');
  });
  it('builds an absolute preview url from the request origin', () => {
    expect(previewUrlFor('https://app.codepet.com', 'b9')).toBe('https://app.codepet.com/preview/b9');
  });
});
