// Server-side reader for the caller's approved-deliverable Library
// (companies/{uid}/library/{itemId}), authorized by THEIR Firebase ID token — same
// trust model as serverBrief. Returns a compact, newest-first list that /api/run-task
// grounds byte on so new deliverables stay consistent with what's already shipped.
// Server-only (no 'use client').
import { fsToJs, getProjectId, type FsValue } from './firestoreRest';
import type { PriorItem } from '@/lib/ai/priorWork';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// Only the fields we ground on — masked so we never pull whole rich payloads
// (site HTML, sheets) we don't need. `createdAt` is fetched only to sort newest-first.
const FIELDS = ['title', 'dept', 'k', 'type', 'out', 'createdAt'];

/**
 * Load up to `limit` of the caller's approved deliverables, newest first. Fail-open:
 * any misconfig / network / rules error returns [] so grounding is simply skipped and
 * generation proceeds — prior-work context must never break a deliverable run.
 */
export async function loadServerLibrary(
  uid: string,
  idToken: string,
  limit = 50,
): Promise<PriorItem[]> {
  const pid = getProjectId();
  if (!pid) return [];
  const base = `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/companies/${encodeURIComponent(uid)}/library`;
  const params = new URLSearchParams({ pageSize: String(limit) });
  for (const f of FIELDS) params.append('mask.fieldPaths', f);
  try {
    const res = await fetch(`${base}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      documents?: Array<{ fields?: Record<string, FsValue> }>;
    };
    const rows = (json.documents ?? []).map((d) => {
      const f = d.fields ?? {};
      return {
        title: str(fsToJs(f.title)),
        dept: str(fsToJs(f.dept)),
        k: str(fsToJs(f.k)),
        type: str(fsToJs(f.type)),
        out: str(fsToJs(f.out)),
        createdAt: num(fsToJs(f.createdAt)),
      };
    });
    // Sort newest-first here (not via REST orderBy — avoids an index requirement and a
    // failed read if some legacy doc lacks createdAt), then drop the sort key.
    rows.sort((a, b) => b.createdAt - a.createdAt);
    return rows
      .filter((r) => r.title && r.out)
      .map(({ title, dept, k, type, out }) => ({ title, dept, k, type, out }));
  } catch {
    return [];
  }
}
