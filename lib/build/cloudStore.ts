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

/** Storage path prefix for a build's files. Namespaced by buildSessionId only (no
 *  companyId): the public /preview/{buildSessionId} route has just the session id, and
 *  the id is already a unique UUID. The Firestore liveBuild doc is still keyed by
 *  companyId — see `paths.liveBuild`. */
export function buildStoragePrefix(buildSessionId: string): string {
  return `builds/preview/${buildSessionId}`;
}

/** Absolute preview URL for a finished build, built from the request's own origin. */
export function previewUrlFor(origin: string, buildSessionId: string): string {
  return `${origin}/preview/${buildSessionId}`;
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

  // Bind this finalize to the caller's OWN build before touching Storage or charging.
  // liveBuild docs are keyed under companies/{companyId}/liveBuilds/{buildSessionId} — a
  // buildSessionId belonging to a different company simply can't exist under this
  // companyId's collection, so a missing doc means either a bogus id or (critically) an
  // attempt to post another company's buildSessionId to overwrite its public preview /
  // fake its charge. `ended === true` means this build was already finalized once (e.g.
  // the sandbox launcher's EXIT trap firing twice) — treat as an idempotent no-op so we
  // never double-store or double-charge.
  const liveRef = adminDb().doc(paths.liveBuild(companyId, buildSessionId));
  const liveSnap = await liveRef.get();
  if (!liveSnap.exists) {
    return { ok: false, reason: 'no_such_build' };
  }
  if (liveSnap.data()?.ended === true) {
    return { ok: false, reason: 'already_ended' };
  }

  const prefix = buildStoragePrefix(buildSessionId);
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

  const previewUrl = status === 'ok' ? previewUrlFor(origin, buildSessionId) : undefined;
  await liveRef.set(
    { ended: true, tokens: body.tokens, ...(previewUrl ? { previewUrl } : {}) },
    { merge: true },
  );

  // Charge exactly on success — increment today's per-company usage doc's route.build.calls,
  // the same field `creditsFromUsage` sums (calls × creditCostForRoute(key)); no separate
  // "charge credit" write exists elsewhere to reuse.
  if (status === 'ok') {
    const day = dayKey(new Date());
    await adminDb()
      .doc(`companies/${companyId}/usage/${day}`)
      .set({ route: { build: { calls: FieldValue.increment(1) } } }, { merge: true });
  }

  return { ok: true };
}
