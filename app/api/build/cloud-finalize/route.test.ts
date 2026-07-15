import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockedFunction } from 'vitest';

vi.mock('@/lib/build/cloudStore', () => ({
  finalizeBuild: vi.fn(),
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: vi.fn(),
}));

import { POST } from './route';
import { finalizeBuild } from '@/lib/build/cloudStore';
import { adminDb } from '@/lib/firebase/admin';

const mockFinalizeBuild = finalizeBuild as MockedFunction<typeof finalizeBuild>;
const mockAdminDb = adminDb as MockedFunction<typeof adminDb>;

function req(body: unknown): Request {
  return new Request('http://localhost/api/build/cloud-finalize', {
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
  files: [{ path: 'index.html', base64: 'aGVsbG8=' }],
};

beforeEach(() => {
  mockFinalizeBuild.mockReset();
  mockAdminDb.mockReset();
  mockFinalizeBuild.mockResolvedValue(undefined);
  mockAdminDb.mockReturnValue(fakeDb('ingest-token') as unknown as ReturnType<typeof adminDb>);
});

describe('POST /api/build/cloud-finalize', () => {
  it('400s on invalid JSON', async () => {
    const res = await POST(
      new Request('http://localhost/api/build/cloud-finalize', {
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
    expect(mockFinalizeBuild).not.toHaveBeenCalled();
  });

  it('401s when token does not match the stored ingestToken', async () => {
    const res = await POST(req({ ...validBody, token: 'wrong-token' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(mockFinalizeBuild).not.toHaveBeenCalled();
  });

  it('401s when the company has no ingestToken on file', async () => {
    mockAdminDb.mockReturnValue(fakeDb(undefined) as unknown as ReturnType<typeof adminDb>);
    const res = await POST(req(validBody));
    expect(res.status).toBe(401);
    expect(mockFinalizeBuild).not.toHaveBeenCalled();
  });

  it('400s when the payload fails sanitization (path traversal) and never calls finalizeBuild', async () => {
    const res = await POST(
      req({ ...validBody, files: [{ path: '../evil', base64: 'eA==' }] }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid payload' });
    expect(mockFinalizeBuild).not.toHaveBeenCalled();
  });

  it('200s and calls finalizeBuild with status ok on a valid body', async () => {
    const res = await POST(req(validBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockFinalizeBuild).toHaveBeenCalledTimes(1);
    const arg = mockFinalizeBuild.mock.calls[0][0];
    expect(arg.companyId).toBe('co1');
    expect(arg.buildSessionId).toBe('sess1');
    expect(arg.status).toBe('ok');
    expect(arg.origin).toBe('http://localhost');
    expect(arg.body).toEqual({
      tokens: 1234,
      files: [{ path: 'index.html', base64: 'aGVsbG8=' }],
    });
  });

  it('calls finalizeBuild with status error when the body reports status error', async () => {
    const res = await POST(req({ ...validBody, status: 'error' }));
    expect(res.status).toBe(200);
    expect(mockFinalizeBuild).toHaveBeenCalledTimes(1);
    expect(mockFinalizeBuild.mock.calls[0][0].status).toBe('error');
  });

  it('500s with finalize_failed when finalizeBuild rejects', async () => {
    mockFinalizeBuild.mockRejectedValue(new Error('storage down'));
    const res = await POST(req(validBody));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'finalize_failed' });
  });
});
