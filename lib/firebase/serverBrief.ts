// Server-side brief loader: read the caller's OWN company doc from Firestore over
// REST, authorized by THEIR Firebase ID token, so the read is subject to the same
// security rules — no service account needed, and the brief is always the one
// persisted under the signed-in account (trust the account, not the client).
// Shared by /api/run-task and /api/personalize. Server-only (no 'use client').
import { fsToJs, getProjectId, type FsValue } from './firestoreRest';

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
