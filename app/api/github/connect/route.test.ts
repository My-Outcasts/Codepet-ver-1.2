import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockedFunction } from 'vitest';

vi.mock('@/lib/firebase/admin', () => ({
  verifyIdToken: vi.fn(),
}));

vi.mock('@/lib/github/state', () => ({
  signState: vi.fn(),
}));

import { GET } from './route';
import { verifyIdToken } from '@/lib/firebase/admin';
import { signState } from '@/lib/github/state';

const mockVerifyIdToken = verifyIdToken as MockedFunction<typeof verifyIdToken>;
const mockSignState = signState as MockedFunction<typeof signState>;

function req(opts: { auth?: string } = {}): Request {
  const headers: Record<string, string> = {};
  if (opts.auth !== undefined) headers.authorization = opts.auth;
  else headers.authorization = 'Bearer good-token';
  return new Request('http://localhost/api/github/connect', { headers });
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  mockVerifyIdToken.mockReset();
  mockSignState.mockReset();
  process.env = { ...ORIGINAL_ENV };

  // uid is 'co1' — the route must derive companyId from this, never from the request.
  mockVerifyIdToken.mockResolvedValue({ uid: 'co1' } as Awaited<ReturnType<typeof verifyIdToken>>);
  mockSignState.mockReturnValue('signed-state-token');
});

describe('GET /api/github/connect', () => {
  it('401s without a bearer token', async () => {
    const res = await GET(req({ auth: '' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(mockSignState).not.toHaveBeenCalled();
  });

  it('401s when the token fails verification', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('bad token'));
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(mockSignState).not.toHaveBeenCalled();
  });

  it('200s with an install URL carrying the signed state, using the verified uid as companyId', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);

    // Signed with the verified uid, never anything from the request.
    expect(mockSignState).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'co1', nonce: expect.any(String) }),
    );

    const { url } = (await res.json()) as { url: string };
    expect(url).toContain('https://github.com/apps/');
    expect(url).toContain('/installations/new?state=');
    expect(url).toContain(encodeURIComponent('signed-state-token'));
  });

  it('defaults the app slug to codepet-builder when GITHUB_APP_SLUG is unset', async () => {
    delete process.env.GITHUB_APP_SLUG;
    const res = await GET(req());
    const { url } = (await res.json()) as { url: string };
    expect(url).toContain('https://github.com/apps/codepet-builder/installations/new');
  });

  it('uses GITHUB_APP_SLUG when set', async () => {
    process.env.GITHUB_APP_SLUG = 'my-custom-app';
    const res = await GET(req());
    const { url } = (await res.json()) as { url: string };
    expect(url).toContain('https://github.com/apps/my-custom-app/installations/new');
  });
});
