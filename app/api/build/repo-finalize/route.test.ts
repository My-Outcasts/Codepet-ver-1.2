import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockedFunction } from 'vitest';

vi.mock('@/lib/build/repoFinalize', () => ({
  finalizeRepoBuild: vi.fn(),
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: vi.fn(),
}));

import { POST } from './route';
import { finalizeRepoBuild } from '@/lib/build/repoFinalize';
import { adminDb } from '@/lib/firebase/admin';

const mockFinalizeRepoBuild = finalizeRepoBuild as MockedFunction<typeof finalizeRepoBuild>;
const mockAdminDb = adminDb as MockedFunction<typeof adminDb>;

function req(body: unknown): Request {
  return new Request('http://localhost/api/build/repo-finalize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** A fake Firestore handle: `.doc(...).get()` resolves to a company snapshot carrying
 *  `ingestToken` (or a missing doc when `ingestToken` is undefined). */
function fakeDb(ingestToken: string | undefined) {
  const getSpy = vi.fn().mockResolvedValue({
    exists: ingestToken !== undefined,
    data: () => (ingestToken !== undefined ? { ingestToken } : undefined),
  });
  const docSpy = vi.fn(() => ({ get: getSpy }));
  return { doc: docSpy, __getSpy: getSpy };
}

const validBody = {
  companyId: 'co1',
  token: 'ingest-token',
  buildSessionId: 'sess1',
  status: 'ok',
  tokens: 1234,
  prUrl: 'https://github.com/acme/repo/pull/1',
  branch: 'codepet/sess1',
  pushed: true,
};

beforeEach(() => {
  mockFinalizeRepoBuild.mockReset();
  mockAdminDb.mockReset();
  mockFinalizeRepoBuild.mockResolvedValue({ ok: true });
  mockAdminDb.mockReturnValue(fakeDb('ingest-token') as unknown as ReturnType<typeof adminDb>);
});

describe('POST /api/build/repo-finalize', () => {
  it('400s on invalid JSON', async () => {
    const res = await POST(
      new Request('http://localhost/api/build/repo-finalize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid json' });
  });

  it('400s when companyId/token/buildSessionId is missing', async () => {
    const res = await POST(req({ token: 'x', buildSessionId: 'y' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad_request' });
    expect(mockFinalizeRepoBuild).not.toHaveBeenCalled();
  });

  it('401s when token does not match the stored ingestToken', async () => {
    const res = await POST(req({ ...validBody, token: 'wrong-token' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(mockFinalizeRepoBuild).not.toHaveBeenCalled();
  });

  it('401s when the company has no ingestToken on file', async () => {
    mockAdminDb.mockReturnValue(fakeDb(undefined) as unknown as ReturnType<typeof adminDb>);
    const res = await POST(req(validBody));
    expect(res.status).toBe(401);
    expect(mockFinalizeRepoBuild).not.toHaveBeenCalled();
  });

  it('404s with no_such_build when finalizeRepoBuild reports the buildSessionId is unknown', async () => {
    mockFinalizeRepoBuild.mockResolvedValue({ ok: false, reason: 'no_such_build' });
    const res = await POST(req(validBody));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no_such_build' });
  });

  it('200s idempotently when finalizeRepoBuild reports the build already ended', async () => {
    mockFinalizeRepoBuild.mockResolvedValue({ ok: false, reason: 'already_ended' });
    const res = await POST(req(validBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('200s and calls finalizeRepoBuild with status ok, pushed true, and prUrl on a valid body', async () => {
    const res = await POST(req(validBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockFinalizeRepoBuild).toHaveBeenCalledTimes(1);
    const arg = mockFinalizeRepoBuild.mock.calls[0][0];
    expect(arg).toEqual({
      companyId: 'co1',
      buildSessionId: 'sess1',
      status: 'ok',
      tokens: 1234,
      prUrl: 'https://github.com/acme/repo/pull/1',
      branch: 'codepet/sess1',
      pushed: true,
    });
  });

  it('only the literal status "ok" charges — a missing/garbage status maps to error (no charge)', async () => {
    const resMissing = await POST(req({ ...validBody, status: undefined }));
    expect(resMissing.status).toBe(200);
    expect(mockFinalizeRepoBuild.mock.calls[0][0].status).toBe('error');

    mockFinalizeRepoBuild.mockClear();
    const resGarbage = await POST(req({ ...validBody, status: 'garbage' }));
    expect(resGarbage.status).toBe(200);
    expect(mockFinalizeRepoBuild.mock.calls[0][0].status).toBe('error');
  });

  it('500s with finalize_failed when finalizeRepoBuild rejects', async () => {
    mockFinalizeRepoBuild.mockRejectedValue(new Error('firestore down'));
    const res = await POST(req(validBody));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'finalize_failed' });
  });
});
