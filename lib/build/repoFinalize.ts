// Server-only: records a GitHub-backed cloud build's PR outcome on the build's live doc
// and charges 5 company credits — but ONLY when a real push landed (status 'ok' AND
// pushed true). Mirrors finalizeBuild's (lib/build/cloudStore.ts) runTransaction-based
// atomic claim (missing doc → no_such_build, already ended → already_ended, else claim
// by setting ended:true) so a retried finalize for the same buildSessionId never
// double-records the PR or double-charges. Unlike finalizeBuild — which charges on any
// 'ok' status — this charges strictly on a successful push, since an 'ok' repo build
// with nothing to push (no changes) did no billable work.
import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebase/admin';
import { paths } from '../firebase/schema';
import { dayKey } from '../ai/rateLimit';

export interface RepoFinalizeResult {
  ok: boolean;
  reason?: 'no_such_build' | 'already_ended';
}

export async function finalizeRepoBuild(args: {
  companyId: string;
  buildSessionId: string;
  status: 'ok' | 'error';
  tokens: number;
  prUrl?: string;
  branch?: string;
  pushed: boolean;
}): Promise<RepoFinalizeResult> {
  const { companyId, buildSessionId, status, tokens, prUrl, branch, pushed } = args;

  const db = adminDb();
  const liveRef = db.doc(paths.liveBuild(companyId, buildSessionId));

  // Atomic claim, mirroring finalizeBuild's TOCTOU-safe read-then-write: a missing doc
  // means either a bogus buildSessionId or another company's id (cross-tenant guard);
  // ended === true means this build was already finalized once — treat as an idempotent
  // no-op so a retried finalize call never double-records the PR or double-charges.
  const claim: RepoFinalizeResult = await db.runTransaction(async (tx) => {
    const snap = await tx.get(liveRef);
    if (!snap.exists) {
      return { ok: false, reason: 'no_such_build' };
    }
    if (snap.data()?.ended === true) {
      return { ok: false, reason: 'already_ended' };
    }
    tx.set(
      liveRef,
      {
        ended: true,
        tokens,
        ...(prUrl ? { prUrl } : {}),
        ...(branch ? { branch } : {}),
      },
      { merge: true },
    );
    return { ok: true };
  });

  if (!claim.ok) {
    return claim;
  }

  // Charge exactly when a real push landed — increment today's per-company usage doc's
  // route.build.calls, the same field `creditsFromUsage` sums (calls × creditCostForRoute
  // ('build') === 5). status:'error' or pushed:false (nothing to push) must NOT charge.
  if (status === 'ok' && pushed === true) {
    const day = dayKey(new Date());
    await adminDb()
      .doc(`companies/${companyId}/usage/${day}`)
      .set({ route: { build: { calls: FieldValue.increment(1) } } }, { merge: true });
  }

  return { ok: true };
}
