import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockedFunction } from 'vitest';

vi.mock('@/lib/firebase/admin', () => ({
  verifyIdToken: vi.fn(),
}));

vi.mock('@/lib/firebase/companyDataAdmin', () => ({
  getCompanyGithub: vi.fn(),
  getCompanyGithubUserToken: vi.fn(),
}));

vi.mock('@/lib/github/repos', () => ({
  listInstallationRepos: vi.fn(),
  createRepoFromTemplate: vi.fn(),
  addRepoToInstallation: vi.fn(),
}));

import { GET, POST } from './route';
import { verifyIdToken } from '@/lib/firebase/admin';
import { getCompanyGithub, getCompanyGithubUserToken } from '@/lib/firebase/companyDataAdmin';
import {
  listInstallationRepos,
  createRepoFromTemplate,
  addRepoToInstallation,
} from '@/lib/github/repos';

const mockVerifyIdToken = verifyIdToken as MockedFunction<typeof verifyIdToken>;
const mockGetCompanyGithub = getCompanyGithub as MockedFunction<typeof getCompanyGithub>;
const mockGetCompanyGithubUserToken = getCompanyGithubUserToken as MockedFunction<
  typeof getCompanyGithubUserToken
>;
const mockListInstallationRepos = listInstallationRepos as MockedFunction<
  typeof listInstallationRepos
>;
const mockCreateRepoFromTemplate = createRepoFromTemplate as MockedFunction<
  typeof createRepoFromTemplate
>;
const mockAddRepoToInstallation = addRepoToInstallation as MockedFunction<
  typeof addRepoToInstallation
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
  mockGetCompanyGithubUserToken.mockReset();
  mockListInstallationRepos.mockReset();
  mockCreateRepoFromTemplate.mockReset();
  mockAddRepoToInstallation.mockReset();

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

  it('400s with bad_request on a name that fails sanitize', async () => {
    const res = await POST(req({ method: 'POST', body: { name: 'a b' } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad_request' });
    expect(mockCreateRepoFromTemplate).not.toHaveBeenCalled();
  });

  it('400s with reconnect_github when no user token is stored', async () => {
    mockGetCompanyGithubUserToken.mockResolvedValue(null);
    const res = await POST(req({ method: 'POST', body: { name: 'myapp' } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'reconnect_github' });
    expect(mockCreateRepoFromTemplate).not.toHaveBeenCalled();
  });

  it('200s with { repo: { owner, name } } on success — no token, no id leaked', async () => {
    mockGetCompanyGithubUserToken.mockResolvedValue('ghu_tok');
    mockGetCompanyGithub.mockResolvedValue({ installationId: 'inst9', login: 'acme' });
    mockCreateRepoFromTemplate.mockResolvedValue({ owner: 'acme', name: 'myapp', id: 12345 });
    mockAddRepoToInstallation.mockResolvedValue();

    const res = await POST(req({ method: 'POST', body: { name: 'myapp' } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ repo: { owner: 'acme', name: 'myapp' } });
    expect(JSON.stringify(json)).not.toContain('ghu_tok');
    expect(JSON.stringify(json)).not.toContain('12345');

    expect(mockCreateRepoFromTemplate).toHaveBeenCalledWith('ghu_tok', 'myapp');
    expect(mockAddRepoToInstallation).toHaveBeenCalledWith('ghu_tok', 'inst9', 12345);
  });

  it('422s with create_failed when createRepoFromTemplate throws', async () => {
    mockGetCompanyGithubUserToken.mockResolvedValue('ghu_tok');
    mockGetCompanyGithub.mockResolvedValue({ installationId: 'inst9', login: 'acme' });
    mockCreateRepoFromTemplate.mockRejectedValue(new Error('nope'));

    const res = await POST(req({ method: 'POST', body: { name: 'myapp' } }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'create_failed' });
    expect(mockAddRepoToInstallation).not.toHaveBeenCalled();
  });

  it('502s with coverage_failed when addRepoToInstallation throws', async () => {
    mockGetCompanyGithubUserToken.mockResolvedValue('ghu_tok');
    mockGetCompanyGithub.mockResolvedValue({ installationId: 'inst9', login: 'acme' });
    mockCreateRepoFromTemplate.mockResolvedValue({ owner: 'acme', name: 'myapp', id: 12345 });
    mockAddRepoToInstallation.mockRejectedValue(new Error('nope'));

    const res = await POST(req({ method: 'POST', body: { name: 'myapp' } }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'coverage_failed' });
  });
});
