// Server-side persistence for byte's generated roadmap — mirrors serverBrief: read/write the
// caller's OWN companies/{uid}.roadmap field over Firestore REST, authorized by their ID
// token (subject to the same security rules, no service account). Server-only.
import { fsToJs, jsToFs, getProjectId, type FsValue } from './firestoreRest';
import type { RoadmapTaskDef } from '../overview/roadmapModel';

/** Persist the generated roadmap under companies/{uid}.roadmap. Fail-open (returns false). */
export async function writeServerRoadmap(
  uid: string,
  idToken: string,
  roadmap: RoadmapTaskDef[],
): Promise<boolean> {
  const pid = getProjectId();
  if (!pid) return false;
  const url =
    `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/companies/${encodeURIComponent(uid)}` +
    `?updateMask.fieldPaths=roadmap&currentDocument.exists=true`;
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${idToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ fields: { roadmap: jsToFs(roadmap) } }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Load the persisted roadmap from companies/{uid}.roadmap, or null. */
export async function loadServerRoadmap(uid: string, idToken: string): Promise<unknown> {
  const pid = getProjectId();
  if (!pid) return null;
  const url = `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/companies/${encodeURIComponent(uid)}?mask.fieldPaths=roadmap`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
    if (!res.ok) return null;
    const json = (await res.json()) as { fields?: { roadmap?: FsValue } };
    return fsToJs(json.fields?.roadmap);
  } catch {
    return null;
  }
}
