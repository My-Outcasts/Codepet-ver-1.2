import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockedFunction } from 'vitest';

vi.mock('@/lib/firebase/admin', () => ({
  verifyIdToken: vi.fn(),
}));

vi.mock('@/lib/firebase/companyDataAdmin', () => ({
  getCompanyGithub: vi.fn(),
}));

vi.mock('@/lib/github/repos', () => ({
  listInstallationRepos: vi.fn(),
  createRepoFromTemplate: vi.fn(),
}));

import { GET, POST } from './route';
import { verifyIdToken } from '@/lib/firebase/admin';
import { getCompanyGithub } from '@/lib/firebase/companyDataAdmin';
import { listInstallationRepos, createRepoFromTemplate } from '@/lib/github/repos';

const mockVerifyIdToken = verifyIdToken as MockedFunction<typeof verifyIdToken>;
const mockGetCompanyGithub = getCompanyGithub as MockedFunction<typeof getCompanyGithub>;
const mockListInstallationRepos = listInstallationRepos as MockedFunction<
  typeof listInstallationRepos
>;
const mockCreateRepoFromTemplate = createRepoFromTemplate as MockedFunction<
  typeof createRepoFromTemplate
>;

function req(opts: { auth?: string; method?: string; body?: unknown } = {}): Request {
  const headers: Record<string, string> = {};
  if (opts.auth !== undefined) headers.authorization = opts.auth;
  else headers.authorization = 'Bearer good-token';
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return new Request('http://localhost/api/github/repos', {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

beforeEach(() => {
  mockVerifyIdToken.mockReset();
  mockGetCompanyGithub.mockReset();
  mockListInstallationRepos.mockReset();
  mockCreateRepoFromTemplate.mockReset();

  mockVerifyIdToken.mockResolvedValue({ uid: 'co1' } as Awaited<ReturnType<typeof verifyIdToken>>);
});

describe('GET /api/github/repos', () => {
  it('401s without a bearer token', async () => {
    const res = await GET(req({ auth: '' }));
    expect(res.status).toBe(401);
    expect(mockGetCompanyGithub).not.toHaveBeenCalled();
  });

  it('401s when the token fails verification', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('bad token'));
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it('404s with not_connected when the company has no github installation', async () => {
    mockGetCompanyGithub.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_connected' });
    expect(mockListInstallationRepos).not.toHaveBeenCalled();
  });

  it('200s with { repos } when connected', async () => {
    mockGetCompanyGithub.mockResolvedValue({ installationId: 'inst1', login: 'acme' });
    mockListInstallationRepos.mockResolvedValue([{ owner: 'acme', name: 'starter-app' }]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ repos: [{ owner: 'acme', name: 'starter-app' }] });
    expect(mockListInstallationRepos).toHaveBeenCalledWith('inst1');
  });
});

describe('POST /api/github/repos', () => {
  it('401s without a bearer token', async () => {
    const res = await POST(req({ auth: '', method: 'POST', body: { name: 'my-app' } }));
    expect(res.status).toBe(401);
  });

  it('400s on a blank name', async () => {
    const res = await POST(req({ method: 'POST', body: { name: '  ' } }));
    expect(res.status).toBe(400);
    expect(mockCreateRepoFromTemplate).not.toHaveBeenCalled();
  });

  it('501s with create_not_available (Phase 1 has no stored user token yet)', async () => {
    const res = await POST(req({ method: 'POST', body: { name: 'my-app' } }));
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({
      error: 'create_not_available',
      message: 'Repo creation is coming soon — connect an existing repo for now.',
    });
    expect(mockCreateRepoFromTemplate).not.toHaveBeenCalled();
  });
});
