// Shared helpers for reading Firestore over its REST API, authorized by the caller's
// OWN Firebase ID token (same trust model everywhere: no service account, subject to
// the deployed security rules). Used by serverBrief (get one doc) and serverLibrary
// (list a subcollection). Pure + dependency-free so it runs server-side and unit-tests.

/** A Firestore REST value node (the wire shape of a document field). */
export interface FsValue {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  arrayValue?: { values?: FsValue[] };
  mapValue?: { fields?: Record<string, FsValue> };
}

/** Convert a Firestore REST value node into a plain JS value. */
export function fsToJs(v: FsValue | undefined): unknown {
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

/** The Firebase project id, from either server or public env. Null ⇒ misconfigured. */
export function getProjectId(): string | null {
  return process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || null;
}
