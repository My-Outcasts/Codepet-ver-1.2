// Server-side brief loader: read the caller's OWN company doc from Firestore over
// REST, authorized by THEIR Firebase ID token, so the read is subject to the same
// security rules — no service account needed, and the brief is always the one
// persisted under the signed-in account (trust the account, not the client).
// Shared by /api/run-task and /api/personalize. Server-only (no 'use client').
import { fsToJs, jsToFs, getProjectId, type FsValue } from './firestoreRest';
import type { CompanyBrief } from './schema';

/** Persist the `brief` field of companies/{uid} (e.g. after byte enriches it), authorized
 *  by the caller's token. Fail-open (returns false) — a failed write just keeps the seed. */
export async function writeServerBrief(
  uid: string,
  idToken: string,
  brief: CompanyBrief,
): Promise<boolean> {
  const pid = getProjectId();
  if (!pid) return false;
  const url =
    `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/companies/${encodeURIComponent(uid)}` +
    `?updateMask.fieldPaths=brief&currentDocument.exists=true`;
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${idToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ fields: { brief: jsToFs(brief) } }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Load the `brief` field of companies/{uid}, authorized by the caller's token. */
export async function loadServerBrief(uid: string, idToken: string): Promise<unknown> {
  const projectId = getProjectId();
  if (!projectId) return null;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/companies/${encodeURIComponent(uid)}?mask.fieldPaths=brief`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
    if (!res.ok) return null;
    const json = (await res.json()) as { fields?: { brief?: FsValue } };
    return fsToJs(json.fields?.brief);
  } catch {
    return null;
  }
}
