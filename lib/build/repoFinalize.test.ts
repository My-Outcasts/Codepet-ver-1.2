// Unit tests for finalizeRepoBuild's atomic double-finalize claim (mirrors
// cloudStore.finalize.test.ts) and its charge-on-successful-push gate: unlike
// finalizeBuild (charges on any 'ok' status), finalizeRepoBuild must charge ONLY when
// status is 'ok' AND a real push landed (pushed:true) — a build that succeeded but had
// nothing to push, or that errored outright, must never be charged.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockedFunction } from 'vitest';

vi.mock('../firebase/admin', () => ({
  adminDb: vi.fn(),
}));

vi.mock('../ai/rateLimit', () => ({
  dayKey: vi.fn(() => '2026-07-16'),
}));

import { finalizeRepoBuild } from './repoFinalize';
import { adminDb } from '../firebase/admin';

const mockAdminDb = adminDb as MockedFunction<typeof adminDb>;

/** A fake Firestore handle, same shape as cloudStore.finalize.test.ts's fakeDb: the
 *  liveBuild doc (path containing '/liveBuilds/') carries `liveExists`/`liveData`, any
 *  other doc (the usage doc) is a bare set-spy. `.runTransaction(fn)` runs `fn` against a
 *  `tx` whose `get`/`set` delegate to the same ref's get/set spies. */
function fakeDb(liveExists: boolean, liveData: Record<string, unknown> = {}) {
  const liveGet = vi.fn().mockResolvedValue({
    exists: liveExists,
    data: () => liveData,
  });
  const liveSet = vi.fn().mockResolvedValue(undefined);
  const usageSet = vi.fn().mockResolvedValue(undefined);
  const docSpy = vi.fn((path: string) => {
    if (path.includes('/liveBuilds/')) return { get: liveGet, set: liveSet };
    return { set: usageSet };
  });
  const runTransaction = vi.fn(async (updateFn: (tx: unknown) => unknown) => {
    const tx = {
      get: (ref: { get: () => unknown }) => ref.get(),
      set: (
        ref: { set: (data: unknown, opts?: unknown) => unknown },
        data: unknown,
        opts?: unknown,
      ) => ref.set(data, opts),
    };
    return updateFn(tx);
  });
  return {
    doc: docSpy,
    runTransaction,
    __liveGet: liveGet,
    __liveSet: liveSet,
    __usageSet: usageSet,
    __runTransaction: runTransaction,
  };
}

const baseArgs = {
  companyId: 'co1',
  buildSessionId: 'sess1',
  tokens: 250,
};

beforeEach(() => {
  mockAdminDb.mockReset();
});

describe('finalizeRepoBuild', () => {
  it('returns no_such_build and never claims or charges when there is no live doc (cross-tenant / bogus buildSessionId guard)', async () => {
    const db = fakeDb(false);
    mockAdminDb.mockReturnValue(db as unknown as ReturnType<typeof adminDb>);

    const result = await finalizeRepoBuild({
      ...baseArgs,
      status: 'ok',
      pushed: true,
      prUrl: 'https://github.com/acme/repo/pull/1',
    });

    expect(result).toEqual({ ok: false, reason: 'no_such_build' });
    expect(db.__runTransaction).toHaveBeenCalledTimes(1);
    expect(db.__liveSet).not.toHaveBeenCalled();
    expect(db.__usageSet).not.toHaveBeenCalled();
  });

  it('returns already_ended and never claims or charges again on a repeat finalize', async () => {
    const db = fakeDb(true, { ended: true });
    mockAdminDb.mockReturnValue(db as unknown as ReturnType<typeof adminDb>);

    const result = await finalizeRepoBuild({
      ...baseArgs,
      status: 'ok',
      pushed: true,
      prUrl: 'https://github.com/acme/repo/pull/1',
    });

    expect(result).toEqual({ ok: false, reason: 'already_ended' });
    expect(db.__runTransaction).toHaveBeenCalledTimes(1);
    expect(db.__liveSet).not.toHaveBeenCalled();
    expect(db.__usageSet).not.toHaveBeenCalled();
  });

  it('claims (ended, tokens, prUrl, branch) inside the transaction and charges once when status is ok and a push landed', async () => {
    const db = fakeDb(true, { ended: false });
    mockAdminDb.mockReturnValue(db as unknown as ReturnType<typeof adminDb>);

    const result = await finalizeRepoBuild({
      ...baseArgs,
      status: 'ok',
      pushed: true,
      prUrl: 'https://github.com/acme/repo/pull/1',
      branch: 'codepet/sess1',
    });

    expect(result).toEqual({ ok: true });
    expect(db.__runTransaction).toHaveBeenCalledTimes(1);
    expect(db.__liveSet).toHaveBeenCalledWith(
      {
        ended: true,
        tokens: 250,
        prUrl: 'https://github.com/acme/repo/pull/1',
        branch: 'codepet/sess1',
      },
      { merge: true },
    );
    expect(db.__liveSet).toHaveBeenCalledTimes(1);
    expect(db.__usageSet).toHaveBeenCalledTimes(1);
    expect(db.__usageSet).toHaveBeenCalledWith(
      { route: { build: { calls: expect.anything() } } },
      { merge: true },
    );
  });

  it('claims but does NOT charge when status is ok but nothing was pushed', async () => {
    const db = fakeDb(true, { ended: false });
    mockAdminDb.mockReturnValue(db as unknown as ReturnType<typeof adminDb>);

    const result = await finalizeRepoBuild({
      ...baseArgs,
      status: 'ok',
      pushed: false,
    });

    expect(result).toEqual({ ok: true });
    expect(db.__liveSet).toHaveBeenCalledWith({ ended: true, tokens: 250 }, { merge: true });
    expect(db.__liveSet).toHaveBeenCalledTimes(1);
    expect(db.__usageSet).not.toHaveBeenCalled();
  });

  it('claims but does NOT charge when status is error, even if pushed is true', async () => {
    const db = fakeDb(true, { ended: false });
    mockAdminDb.mockReturnValue(db as unknown as ReturnType<typeof adminDb>);

    const result = await finalizeRepoBuild({
      ...baseArgs,
      status: 'error',
      pushed: true,
      prUrl: 'https://github.com/acme/repo/pull/1',
    });

    expect(result).toEqual({ ok: true });
    expect(db.__liveSet).toHaveBeenCalledWith(
      { ended: true, tokens: 250, prUrl: 'https://github.com/acme/repo/pull/1' },
      { merge: true },
    );
    expect(db.__usageSet).not.toHaveBeenCalled();
  });
});
