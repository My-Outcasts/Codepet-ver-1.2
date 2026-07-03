// Ingest endpoint for real Claude Code activity. The local SessionEnd hook (see
// toolkit/hooks/codepet-track.mjs) POSTs a session rollup here. Auth is a per-company
// ingest token (the hook has no Firebase user session), checked against the company
// doc. Writes go through the Admin SDK, which needs a service account in prod.
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { paths } from '@/lib/firebase/schema';
import type { TrackEvent } from '@/lib/tracking';

export const runtime = 'nodejs';

const MAX_WINS = 10;
const MAX_WIN_LEN = 200;

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}
function str(v: unknown, max = 200): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
}

/** Drop keys whose value is undefined — the Admin SDK rejects `undefined` field
 *  values (e.g. an absent `branch` when the session ran outside a git repo). */
function dropUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

/** Coerce untrusted input into a stored TrackEvent (id/ts assigned server-side). */
function sanitizeEvent(raw: unknown, id: string, ts: number): TrackEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const sessionId = str(r.sessionId, 128);
  if (!sessionId) return null;
  const wins = Array.isArray(r.wins)
    ? r.wins
        .map((w) => str(w, MAX_WIN_LEN))
        .filter((w): w is string => Boolean(w))
        .slice(0, MAX_WINS)
    : [];
  // Optional string fields (cwd/repo/branch) may be undefined; drop them so the
  // Firestore write doesn't throw on undefined values.
  return dropUndefined({
    id,
    ts,
    sessionId,
    cwd: str(r.cwd, 512),
    repo: str(r.repo, 128),
    branch: str(r.branch, 128),
    commits: num(r.commits),
    prs: num(r.prs),
    linesAdded: num(r.linesAdded),
    linesRemoved: num(r.linesRemoved),
    wins,
  });
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const { companyId, token, event } = (body ?? {}) as {
    companyId?: string;
    token?: string;
    event?: unknown;
  };
  if (!companyId || !token) {
    return NextResponse.json({ error: 'missing companyId or token' }, { status: 400 });
  }

  const db = adminDb();
  const companyRef = db.doc(paths.company(companyId));
  const snap = await companyRef.get();
  const ingestToken = snap.exists ? (snap.data()?.ingestToken as string | undefined) : undefined;
  // Constant work whether or not the company exists; a missing/blank token never matches.
  if (!ingestToken || token !== ingestToken) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const ts = Date.now();
  const ref = db.collection(paths.trackEvents(companyId)).doc();
  const clean = sanitizeEvent(event, ref.id, ts);
  if (!clean) {
    return NextResponse.json({ error: 'invalid event' }, { status: 400 });
  }
  await ref.set(clean);
  return NextResponse.json({ ok: true, id: ref.id });
}
