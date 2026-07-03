// Server-side writer for the company's decisions memory. Patches ONLY the `decisions`
// field of companies/{uid} (updateMask), authorized by the caller's own Firebase ID
// token — same trust model and owner rule as every other server write here. Used by
// /api/remember after byte extracts + merges decisions. Server-only (no 'use client').
import { jsToFs, getProjectId } from './firestoreRest';
import type { DecisionEntry } from '@/lib/ai/projectModel';

/**
 * Overwrite the `decisions` field of companies/{uid} with `decisions`. `currentDocument.
 * exists=true` guards against creating a company doc if it somehow doesn't exist. Returns
 * whether the write succeeded; fail-open (never throws) so extraction is best-effort.
 */
export async function writeServerDecisions(
  uid: string,
  idToken: string,
  decisions: DecisionEntry[],
): Promise<boolean> {
  const pid = getProjectId();
  if (!pid) return false;
  const url =
    `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/companies/${encodeURIComponent(uid)}` +
    `?updateMask.fieldPaths=decisions&currentDocument.exists=true`;
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${idToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ fields: { decisions: jsToFs(decisions) } }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
