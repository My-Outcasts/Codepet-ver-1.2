import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockedFunction } from 'vitest';

vi.mock('@/lib/build/cloudSandbox', () => ({
  startCloudBuild: vi.fn(),
}));

vi.mock('@/lib/firebase/admin', () => ({
  verifyIdToken: vi.fn(),
  adminDb: vi.fn(),
}));

vi.mock('@/lib/firebase/companyData', () => ({
  loadPeriodCredits: vi.fn(),
  ensureIngestToken: vi.fn(),
}));

import { POST } from './route';
import { startCloudBuild } from '@/lib/build/cloudSandbox';
import { verifyIdToken, adminDb } from '@/lib/firebase/admin';
import { loadPeriodCredits, ensureIngestToken } from '@/lib/firebase/companyData';
// Relative, not `@/` — this module isn't mocked, and an unmocked `@/` value import
// doesn't resolve under vitest (see route.ts's import-path comment).
import { PRO_INCLUDED_CREDITS } from '../../../../lib/ai/credits';

const mockStartCloudBuild = startCloudBuild as MockedFunction<typeof startCloudBuild>;
const mockVerifyIdToken = verifyIdToken as MockedFunction<typeof verifyIdToken>;
const mockAdminDb = adminDb as MockedFunction<typeof adminDb>;
const mockLoadPeriodCredits = loadPeriodCredits as MockedFunction<typeof loadPeriodCredits>;
const mockEnsureIngestToken = ensureIngestToken as MockedFunction<typeof ensureIngestToken>;

const plan = { title: 'A todo app', budgetActions: 8, steps: ['seed', 'wire up'] };

function req(body: unknown, opts: { auth?: string } = {}): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.auth !== undefined) headers.authorization = opts.auth;
  else headers.authorization = 'Bearer good-token';
  return new Request('http://localhost/api/build/cloud-start', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

/** A fake Firestore handle: `.collection(...).where(...).where(...).limit(...).get()`
 *  resolves to `{ empty }`, and `.doc(...).set(...)` is a spy. `activeEmpty` controls
 *  whether the single-flight query finds an existing live cloud build. */
function fakeDb(activeEmpty: boolean) {
  const setSpy = vi.fn().mockResolvedValue(undefined);
  const docSpy = vi.fn(() => ({ set: setSpy }));
  const getSpy = vi.fn().mockResolvedValue({ empty: activeEmpty });
  const query = {
    where: vi.fn(() => query),
    limit: vi.fn(() => query),
    get: getSpy,
  };
  const collectionSpy = vi.fn(() => query);
  return { collection: collectionSpy, doc: docSpy, __setSpy: setSpy, __getSpy: getSpy };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  mockStartCloudBuild.mockReset();
  mockVerifyIdToken.mockReset();
  mockAdminDb.mockReset();
  mockLoadPeriodCredits.mockReset();
  mockEnsureIngestToken.mockReset();
  process.env = { ...ORIGINAL_ENV, E2B_API_KEY: 'e2b-key', ANTHROPIC_API_KEY: 'anthropic-key' };

  mockVerifyIdToken.mockResolvedValue({ uid: 'u1' } as Awaited<ReturnType<typeof verifyIdToken>>);
  // Comfortably affordable by default (used well below the allowance).
  mockLoadPeriodCredits.mockResolvedValue(0);
  mockEnsureIngestToken.mockResolvedValue('ingest-token');
  mockStartCloudBuild.mockResolvedValue({ sandboxId: 'sbx1' });
  mockAdminDb.mockReturnValue(
    fakeDb(true) as unknown as ReturnType<typeof adminDb>,
  );
});

describe('POST /api/build/cloud-start', () => {
  it('401s without a bearer token', async () => {
    const res = await POST(req({ companyId: 'c1', plan, brief: 'x' }, { auth: '' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(mockStartCloudBuild).not.toHaveBeenCalled();
  });

  it('401s when the token fails verification', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('bad token'));
    const res = await POST(req({ companyId: 'c1', plan, brief: 'x' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('503s when E2B_API_KEY is unset', async () => {
    delete process.env.E2B_API_KEY;
    const res = await POST(req({ companyId: 'c1', plan, brief: 'x' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'not_configured' });
    expect(mockStartCloudBuild).not.toHaveBeenCalled();
  });

  it('503s when ANTHROPIC_API_KEY is unset', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await POST(req({ companyId: 'c1', plan, brief: 'x' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'not_configured' });
    expect(mockStartCloudBuild).not.toHaveBeenCalled();
  });

  it('400s when companyId is missing', async () => {
    const res = await POST(req({ plan, brief: 'x' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad_request' });
  });

  it('402s when the company cannot afford a build', async () => {
    // used >= allowance ⇒ remaining < the 5-credit build cost.
    mockLoadPeriodCredits.mockResolvedValue(PRO_INCLUDED_CREDITS);
    const res = await POST(req({ companyId: 'c1', plan, brief: 'x' }));
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: 'no_credits' });
    expect(mockStartCloudBuild).not.toHaveBeenCalled();
  });

  it('409s when a cloud build is already in progress for the company', async () => {
    mockAdminDb.mockReturnValue(fakeDb(false) as unknown as ReturnType<typeof adminDb>);
    const res = await POST(req({ companyId: 'c1', plan, brief: 'x' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'build_in_progress' });
    expect(mockStartCloudBuild).not.toHaveBeenCalled();
  });

  it('502s when the sandbox fails to boot', async () => {
    mockStartCloudBuild.mockRejectedValue(new Error('e2b down'));
    const res = await POST(req({ companyId: 'c1', plan, brief: 'x' }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'boot_failed' });
  });

  it('200s with a buildSessionId, boots the sandbox, and writes the initial live doc', async () => {
    const fake = fakeDb(true);
    mockAdminDb.mockReturnValue(fake as unknown as ReturnType<typeof adminDb>);
    const res = await POST(req({ companyId: 'c1', plan, brief: 'do the thing' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.buildSessionId).toBe('string');
    expect(json.buildSessionId.length).toBeGreaterThan(0);
    // Never leaks the anthropic key, E2B key, or ingest token.
    expect(JSON.stringify(json)).not.toContain('anthropic-key');
    expect(JSON.stringify(json)).not.toContain('ingest-token');

    expect(mockStartCloudBuild).toHaveBeenCalledTimes(1);
    const arg = mockStartCloudBuild.mock.calls[0][0];
    expect(arg.anthropicKey).toBe('anthropic-key');
    // cloudBuildScript POSIX-single-quotes the opening prompt (shq), so a literal `'`
    // becomes `'\''` inside the script text.
    expect(arg.script).toContain("CODEPET_OPENING_PROMPT='Let'\\''s build: A todo app");
    expect(arg.script).toContain('do the thing');

    expect(fake.doc).toHaveBeenCalledWith(`companies/c1/liveBuilds/${json.buildSessionId}`);
    expect(fake.__setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'c1', mode: 'cloud', ended: false }),
      { merge: true },
    );
  });
});
