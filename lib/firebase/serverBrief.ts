// Server-side brief loader: read the caller's OWN company doc from Firestore over
// REST, authorized by THEIR Firebase ID token, so the read is subject to the same
// security rules — no service account needed, and the brief is always the one
// persisted under the signed-in account (trust the account, not the client).
// Shared by /api/run-task and /api/personalize. Server-only (no 'use client').

interface FsValue {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  arrayValue?: { values?: FsValue[] };
  mapValue?: { fields?: Record<string, FsValue> };
}

function fsToJs(v: FsValue | undefined): unknown {
  if (!v) return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.arrayValue) return (v.arrayValue.values ?? []).map(fsToJs);
  if (v.mapValue) {
    const out: Record<string, unknown> = {};
    const fields = v.mapValue.fields ?? {};
    for (const k of Object.keys(fields)) out[k] = fsToJs(fields[k]);
    return out;
  }
  return undefined;
}

/** Load the `brief` field of companies/{uid}, authorized by the caller's token. */
export async function loadServerBrief(uid: string, idToken: string): Promise<unknown> {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
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
