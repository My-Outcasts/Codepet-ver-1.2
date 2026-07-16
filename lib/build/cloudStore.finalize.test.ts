// Unit tests for finalizeBuild's cross-tenant guard, atomic double-finalize claim (a
// Firestore transaction, closing the TOCTOU double-charge race), and charge-on-success
// behavior (lib/build/cloudStore.ts). Firestore/Storage are mocked; the goal is to
// verify finalizeBuild's own control flow, not Admin SDK wiring (covered indirectly by
// the route tests).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockedFunction } from 'vitest';

vi.mock('../firebase/admin', () => ({
  adminDb: vi.fn(),
  adminStorage: vi.fn(),
}));

vi.mock('../ai/rateLimit', () => ({
  dayKey: vi.fn(() => '2026-07-16'),
}));

import { finalizeBuild } from './cloudStore';
import { adminDb, adminStorage } from '../firebase/admin';

const mockAdminDb = adminDb as MockedFunction<typeof adminDb>;
const mockAdminStorage = adminStorage as MockedFunction<typeof adminStorage>;

/** A fake Firestore handle. `.doc(path)` returns a get/set spy pair; the liveBuild doc
 *  (path containing '/liveBuilds/') carries `liveExists`/`liveData`, any other doc (the
 *  usage doc) is a bare set-spy. `.runTransaction(fn)` runs `fn` against a `tx` whose
 *  `get`/`set` delegate to the same ref's get/set spies, mirroring how the real Admin
 *  SDK's transaction reads/writes through the same document reference. */
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

/** A fake Storage bucket: `.file(path).save(...)` is a spy. */
function fakeBucket() {
  const save = vi.fn().mockResolvedValue(undefined);
  const file = vi.fn(() => ({ save }));
  return { file, __save: save };
}

const body = {
  tokens: 100,
  files: [{ path: 'index.html', base64: 'aGVsbG8=' }],
};

beforeEach(() => {
  mockAdminDb.mockReset();
  mockAdminStorage.mockReset();
});

describe('finalizeBuild', () => {
  it("returns no_such_build and never stores or charges when the buildSessionId is not this company's build (cross-tenant guard)", async () => {
    const db = fakeDb(false);
    const bucket = fakeBucket();
    mockAdminDb.mockReturnValue(db as unknown as ReturnType<typeof adminDb>);
    mockAdminStorage.mockReturnValue(bucket as unknown as ReturnType<typeof adminStorage>);

    const result = await finalizeBuild({
      companyId: 'victim-co',
      buildSessionId: 'sess-not-mine',
      origin: 'https://app.codepet.com',
      status: 'ok',
      body,
    });

    expect(result).toEqual({ ok: false, reason: 'no_such_build' });
    expect(db.__runTransaction).toHaveBeenCalledTimes(1);
    expect(bucket.file).not.toHaveBeenCalled();
    expect(db.__liveSet).not.toHaveBeenCalled();
    expect(db.__usageSet).not.toHaveBeenCalled();
  });

  it('returns already_ended and never stores or charges again on a repeat finalize (atomic claim rejects it, no double-charge)', async () => {
    const db = fakeDb(true, { ended: true });
    const bucket = fakeBucket();
    mockAdminDb.mockReturnValue(db as unknown as ReturnType<typeof adminDb>);
    mockAdminStorage.mockReturnValue(bucket as unknown as ReturnType<typeof adminStorage>);

    const result = await finalizeBuild({
      companyId: 'co1',
      buildSessionId: 'sess1',
      origin: 'https://app.codepet.com',
      status: 'ok',
      body,
    });

    expect(result).toEqual({ ok: false, reason: 'already_ended' });
    expect(db.__runTransaction).toHaveBeenCalledTimes(1);
    expect(bucket.file).not.toHaveBeenCalled();
    expect(db.__liveSet).not.toHaveBeenCalled();
    expect(db.__usageSet).not.toHaveBeenCalled();
  });

  it("stores files under the companyId-scoped prefix, claims (ended) inside the transaction, and charges once on an ok status for the caller's own build", async () => {
    const db = fakeDb(true, { ended: false });
    const bucket = fakeBucket();
    mockAdminDb.mockReturnValue(db as unknown as ReturnType<typeof adminDb>);
    mockAdminStorage.mockReturnValue(bucket as unknown as ReturnType<typeof adminStorage>);

    const result = await finalizeBuild({
      companyId: 'co1',
      buildSessionId: 'sess1',
      origin: 'https://app.codepet.com',
      status: 'ok',
      body,
    });

    expect(result).toEqual({ ok: true });
    expect(db.__runTransaction).toHaveBeenCalledTimes(1);
    // The claim (ended: true, tokens) is written inside the transaction...
    expect(db.__liveSet).toHaveBeenCalledWith({ ended: true, tokens: 100 }, { merge: true });
    // ...and the storage key is scoped by companyId FIRST, not buildSessionId alone —
    // an attacker who plants a liveBuild doc under their OWN companyId can never write
    // into another company's `builds/{victimCompanyId}/...` prefix.
    expect(bucket.file).toHaveBeenCalledWith('builds/co1/sess1/index.html');
    expect(bucket.__save).toHaveBeenCalledTimes(1);
    // ...previewUrl is written separately, AFTER the transaction/uploads succeed.
    expect(db.__liveSet).toHaveBeenCalledWith(
      { previewUrl: 'https://app.codepet.com/preview/co1/sess1' },
      { merge: true },
    );
    expect(db.__liveSet).toHaveBeenCalledTimes(2);
    expect(db.__usageSet).toHaveBeenCalledTimes(1);
  });

  it('stores files but does not charge or write a previewUrl when status is error', async () => {
    const db = fakeDb(true, { ended: false });
    const bucket = fakeBucket();
    mockAdminDb.mockReturnValue(db as unknown as ReturnType<typeof adminDb>);
    mockAdminStorage.mockReturnValue(bucket as unknown as ReturnType<typeof adminStorage>);

    const result = await finalizeBuild({
      companyId: 'co1',
      buildSessionId: 'sess1',
      origin: 'https://app.codepet.com',
      status: 'error',
      body,
    });

    expect(result).toEqual({ ok: true });
    expect(bucket.__save).toHaveBeenCalledTimes(1);
    expect(db.__liveSet).toHaveBeenCalledTimes(1);
    expect(db.__liveSet).toHaveBeenCalledWith({ ended: true, tokens: 100 }, { merge: true });
    expect(db.__usageSet).not.toHaveBeenCalled();
  });
});
