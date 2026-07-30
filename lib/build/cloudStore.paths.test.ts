import { describe, it, expect } from 'vitest';
import { buildStoragePrefix, previewUrlFor } from './cloudStore';

describe('cloud store paths', () => {
  it('namespaces storage by companyId then build session (tenant-scoped)', () => {
    expect(buildStoragePrefix('co1', 'b9')).toBe('builds/co1/b9');
  });
  it('builds an absolute preview url scoped by companyId from the request origin', () => {
    expect(previewUrlFor('https://app.codepet.com', 'co1', 'b9')).toBe(
      'https://app.codepet.com/preview/co1/b9',
    );
  });
});
