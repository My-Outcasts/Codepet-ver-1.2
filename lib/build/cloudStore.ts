// Server-only: stores a finished cloud build's site files to Admin Storage, marks the
// company's liveBuild doc ended (with the preview URL on success), and — exactly on
// success — charges the build's credit cost by incrementing today's usage doc, mirroring
// the existing `route.{key}.calls` convention `creditsFromUsage` (lib/billing.ts) reads.
import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, adminStorage } from '../firebase/admin';
import { paths } from '../firebase/schema';
import { dayKey } from '../ai/rateLimit';
import type { FinalizeBody } from './finalize';

/** Storage path prefix for a build's files. Namespaced by companyId THEN
 *  buildSessionId — a company can only ever write/read under its own companyId
 *  prefix. (Namespacing by buildSessionId alone let any company that could mint a
 *  valid liveBuild doc for an arbitrary buildSessionId overwrite another company's
 *  public preview at the same storage key — see the finalizeBuild cross-tenant
 *  guard below, which this prefix now backs up structurally.) */
export function buildStoragePrefix(companyId: string, buildSessionId: string): string {
  return `builds/${companyId}/${buildSessionId}`;
}

/** Absolute preview URL for a finished build, built from the request's own origin. */
export function previewUrlFor(origin: string, companyId: string, buildSessionId: string): string {
  return `${origin}/preview/${companyId}/${buildSessionId}`;
}

export interface FinalizeResult {
  ok: boolean;
  reason?: 'no_such_build' | 'already_ended';
}

export async function finalizeBuild(args: {
  companyId: string;
  buildSessionId: string;
  origin: string;
  status: 'ok' | 'error';
  body: FinalizeBody;
}): Promise<FinalizeResult> {
  const { companyId, buildSessionId, origin, status, body } = args;

  const db = adminDb();
  const liveRef = db.doc(paths.liveBuild(companyId, buildSessionId));

  // Bind this finalize to the caller's OWN build, and CLAIM it, atomically. liveBuild
  // docs are keyed under companies/{companyId}/liveBuilds/{buildSessionId} — a
  // buildSessionId belonging to a different company simply can't exist under this
  // companyId's collection, so a missing doc means either a bogus id or (critically) an
  // attempt to post another company's buildSessionId to overwrite its public preview /
  // fake its charge. `ended === true` means this build was already finalized once (e.g.
  // the sandbox launcher's EXIT trap firing twice) — treat as an idempotent no-op so we
  // never double-store or double-charge.
  //
  // The read-then-write here MUST be atomic: two concurrent finalize calls for the same
  // build could otherwise both read `ended !== true` before either writes it, and both
  // proceed to store + charge (a TOCTOU double-charge race). Wrapping the check and the
  // `ended: true` claim in a transaction closes that window — Storage can't be inside a
  // Firestore transaction, so uploads/charging happen only AFTER the claim succeeds.
  const claim: FinalizeResult = await db.runTransaction(async (tx) => {
    const snap = await tx.get(liveRef);
    if (!snap.exists) {
      return { ok: false, reason: 'no_such_build' };
    }
    if (snap.data()?.ended === true) {
      return { ok: false, reason: 'already_ended' };
    }
    tx.set(liveRef, { ended: true, tokens: body.tokens }, { merge: true });
    return { ok: true };
  });

  if (!claim.ok) {
    return claim;
  }

  const prefix = buildStoragePrefix(companyId, buildSessionId);
  const bucket = adminStorage();

  // Store each web file. `f.path` is used verbatim as the storage key — it is already
  // validated traversal-safe by sanitizeFinalizeBody (lib/build/finalize.ts); do not
  // decode/normalize it here, which could re-introduce path traversal.
  await Promise.all(
    body.files.map((f) =>
      bucket.file(`${prefix}/${f.path}`).save(Buffer.from(f.base64, 'base64'), {
        resumable: false,
      }),
    ),
  );

  // Charge exactly on success — increment today's per-company usage doc's route.build.calls,
  // the same field `creditsFromUsage` sums (calls × creditCostForRoute(key)); no separate
  // "charge credit" write exists elsewhere to reuse.
  if (status === 'ok') {
    const previewUrl = previewUrlFor(origin, companyId, buildSessionId);
    await liveRef.set({ previewUrl }, { merge: true });

    const day = dayKey(new Date());
    await adminDb()
      .doc(`companies/${companyId}/usage/${day}`)
      .set({ route: { build: { calls: FieldValue.increment(1) } } }, { merge: true });
  }

  return { ok: true };
}
