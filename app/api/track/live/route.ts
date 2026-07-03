// Live-activity ingest for the Build Coach DURING meter. The local hooks (see
// toolkit/hooks/codepet-live.mjs) POST one LiveEvent per SessionStart/PostToolUse/Stop/Notification.
// Auth is the per-company ingest token, checked against the company doc (same as
// /api/track). The event is folded into liveBuilds/{buildSessionId} via reduceLive
// inside a transaction so concurrent tool events don't clobber each other.
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { paths } from '@/lib/firebase/schema';
import { reduceLive, sanitizeLiveEvent, type LiveState } from '@/lib/liveBuild';

export const runtime = 'nodejs';

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

  const clean = sanitizeLiveEvent(event);
  if (!clean) {
    return NextResponse.json({ error: 'invalid event' }, { status: 400 });
  }

  const ref = db.doc(paths.liveBuild(companyId, clean.buildSessionId));
  await db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    const prev = cur.exists ? (cur.data() as LiveState) : null;
    tx.set(ref, reduceLive(prev, clean));
  });
  return NextResponse.json({ ok: true });
}
