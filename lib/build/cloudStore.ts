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

export async function finalizeBuild(args: {
  companyId: string;
  buildSessionId: string;
  origin: string;
  status: 'ok' | 'error';
  body: FinalizeBody;
}): Promise<void> {
  const { companyId, buildSessionId, origin, status, body } = args;
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
  await adminDb()
    .doc(paths.liveBuild(companyId, buildSessionId))
    .set({ ended: true, tokens: body.tokens, ...(previewUrl ? { previewUrl } : {}) }, { merge: true });

  // Charge exactly on success — increment today's per-company usage doc's route.build.calls,
  // the same field `creditsFromUsage` sums (calls × creditCostForRoute(key)); no separate
  // "charge credit" write exists elsewhere to reuse.
  if (status === 'ok') {
    const day = dayKey(new Date());
    await adminDb()
      .doc(`companies/${companyId}/usage/${day}`)
      .set({ route: { build: { calls: FieldValue.increment(1) } } }, { merge: true });
  }
}
