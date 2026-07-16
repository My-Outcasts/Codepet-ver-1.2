import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockedFunction } from 'vitest';

vi.mock('@/lib/build/cloudSandbox', () => ({
  startCloudBuild: vi.fn(),
}));

vi.mock('@/lib/firebase/admin', () => ({
  verifyIdToken: vi.fn(),
  adminDb: vi.fn(),
}));

vi.mock('@/lib/firebase/companyDataAdmin', () => ({
  loadPeriodCreditsAdmin: vi.fn(),
  ensureIngestTokenAdmin: vi.fn(),
}));

import { POST } from './route';
import { startCloudBuild } from '@/lib/build/cloudSandbox';
import { verifyIdToken, adminDb } from '@/lib/firebase/admin';
import { loadPeriodCreditsAdmin, ensureIngestTokenAdmin } from '@/lib/firebase/companyDataAdmin';
// Relative, not `@/` — this module isn't mocked, and an unmocked `@/` value import
// doesn't resolve under vitest (see route.ts's import-path comment).
import { PRO_INCLUDED_CREDITS } from '../../../../lib/ai/credits';

const mockStartCloudBuild = startCloudBuild as MockedFunction<typeof startCloudBuild>;
const mockVerifyIdToken = verifyIdToken as MockedFunction<typeof verifyIdToken>;
const mockAdminDb = adminDb as MockedFunction<typeof adminDb>;
const mockLoadPeriodCreditsAdmin = loadPeriodCreditsAdmin as MockedFunction<
  typeof loadPeriodCreditsAdmin
>;
const mockEnsureIngestTokenAdmin = ensureIngestTokenAdmin as MockedFunction<
  typeof ensureIngestTokenAdmin
>;

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

/** A fake Firestore handle: `.collection(...).where('ended','==',false).get()` resolves
 *  to `{ docs }` (a single `.where`, no composite index needed — cloud-start filters
 *  `mode === 'cloud'` in code over the returned docs), and `.doc(...).set(...)` is a spy.
 *  `activeCloudBuild` controls whether one of the not-yet-ended docs has `mode: 'cloud'`,
 *  i.e. whether the single-flight check finds an existing live cloud build. */
function fakeDb(activeCloudBuild: boolean) {
  const setSpy = vi.fn().mockResolvedValue(undefined);
  const docSpy = vi.fn(() => ({ set: setSpy }));
  const docs = activeCloudBuild ? [{ data: () => ({ mode: 'cloud', ended: false }) }] : [];
  const getSpy = vi.fn().mockResolvedValue({ docs });
  const query = {
    where: vi.fn(() => query),
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
  mockLoadPeriodCreditsAdmin.mockReset();
  mockEnsureIngestTokenAdmin.mockReset();
  process.env = { ...ORIGINAL_ENV, E2B_API_KEY: 'e2b-key', ANTHROPIC_API_KEY: 'anthropic-key' };

  // uid is 'co1' — the route must derive companyId from this, never from the body.
  mockVerifyIdToken.mockResolvedValue({ uid: 'co1' } as Awaited<ReturnType<typeof verifyIdToken>>);
  // Comfortably affordable by default (used well below the allowance).
  mockLoadPeriodCreditsAdmin.mockResolvedValue(0);
  mockEnsureIngestTokenAdmin.mockResolvedValue('ingest-token');
  mockStartCloudBuild.mockResolvedValue({ sandboxId: 'sbx1' });
  mockAdminDb.mockReturnValue(fakeDb(false) as unknown as ReturnType<typeof adminDb>);
});

describe('POST /api/build/cloud-start', () => {
  it('401s without a bearer token', async () => {
    const res = await POST(req({ plan, brief: 'x' }, { auth: '' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(mockStartCloudBuild).not.toHaveBeenCalled();
  });

  it('401s when the token fails verification', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('bad token'));
    const res = await POST(req({ plan, brief: 'x' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('503s when E2B_API_KEY is unset', async () => {
    delete process.env.E2B_API_KEY;
    const res = await POST(req({ plan, brief: 'x' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'not_configured' });
    expect(mockStartCloudBuild).not.toHaveBeenCalled();
  });

  it('503s when ANTHROPIC_API_KEY is unset', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await POST(req({ plan, brief: 'x' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'not_configured' });
    expect(mockStartCloudBuild).not.toHaveBeenCalled();
  });

  it('400s when plan/brief is missing', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad_request' });
  });

  it('402s when the company cannot afford a build', async () => {
    // used >= allowance ⇒ remaining < the 5-credit build cost.
    mockLoadPeriodCreditsAdmin.mockResolvedValue(PRO_INCLUDED_CREDITS);
    const res = await POST(req({ plan, brief: 'x' }));
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: 'no_credits' });
    expect(mockStartCloudBuild).not.toHaveBeenCalled();
  });

  it('409s when a cloud build is already in progress for the company', async () => {
    mockAdminDb.mockReturnValue(fakeDb(true) as unknown as ReturnType<typeof adminDb>);
    const res = await POST(req({ plan, brief: 'x' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'build_in_progress' });
    expect(mockStartCloudBuild).not.toHaveBeenCalled();
  });

  it('does not 409 when a not-yet-ended doc exists but is not a cloud build (single where, mode filtered in code)', async () => {
    const query = {
      where: vi.fn(function (this: unknown) {
        return this;
      }),
      get: vi.fn().mockResolvedValue({ docs: [{ data: () => ({ mode: 'local', ended: false }) }] }),
    };
    const setSpy = vi.fn().mockResolvedValue(undefined);
    const fake = {
      collection: vi.fn(() => query),
      doc: vi.fn(() => ({ set: setSpy })),
    };
    mockAdminDb.mockReturnValue(fake as unknown as ReturnType<typeof adminDb>);
    const res = await POST(req({ plan, brief: 'x' }));
    expect(res.status).toBe(200);
    // Exactly one `.where` call — no composite (`mode` + `ended`) index needed.
    expect(query.where).toHaveBeenCalledTimes(1);
    expect(query.where).toHaveBeenCalledWith('ended', '==', false);
  });

  it('502s when the sandbox fails to boot', async () => {
    mockStartCloudBuild.mockRejectedValue(new Error('e2b down'));
    const res = await POST(req({ plan, brief: 'x' }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'boot_failed' });
  });

  it('200s with a buildSessionId, boots the sandbox, and writes the initial live doc', async () => {
    const fake = fakeDb(false);
    mockAdminDb.mockReturnValue(fake as unknown as ReturnType<typeof adminDb>);
    const res = await POST(req({ plan, brief: 'do the thing' }));
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

    expect(fake.doc).toHaveBeenCalledWith(`companies/co1/liveBuilds/${json.buildSessionId}`);
    expect(fake.__setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'co1', mode: 'cloud', ended: false }),
      { merge: true },
    );
  });

  it('ignores a companyId in the body and scopes everything to the verified uid (IDOR guard)', async () => {
    const fake = fakeDb(false);
    mockAdminDb.mockReturnValue(fake as unknown as ReturnType<typeof adminDb>);
    // uid resolves to 'co1' (see beforeEach); the body tries to hijack another company.
    const res = await POST(req({ companyId: 'someone-elses-company', plan, brief: 'x' }));
    expect(res.status).toBe(200);
    const json = await res.json();

    // Credit check + ingest token mint must run for the UID, not the body's companyId.
    expect(mockLoadPeriodCreditsAdmin).toHaveBeenCalledWith('co1');
    expect(mockLoadPeriodCreditsAdmin).not.toHaveBeenCalledWith('someone-elses-company');
    expect(mockEnsureIngestTokenAdmin).toHaveBeenCalledWith('co1');
    expect(mockEnsureIngestTokenAdmin).not.toHaveBeenCalledWith('someone-elses-company');

    // The single-flight query and the live-build doc are also scoped to the uid.
    expect(fake.collection).toHaveBeenCalledWith('companies/co1/liveBuilds');
    expect(fake.collection).not.toHaveBeenCalledWith('companies/someone-elses-company/liveBuilds');
    expect(fake.doc).toHaveBeenCalledWith(`companies/co1/liveBuilds/${json.buildSessionId}`);
    expect(fake.__setSpy).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'co1' }), {
      merge: true,
    });
  });
});
