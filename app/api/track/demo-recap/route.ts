// Demo self-report ingest: the demo copy-paste command POSTs a git rollup (commits + files
// changed) so remote testers see real recap stats without installing the toolkit. Auth is the
// per-company ingest token (same as /api/track/live). Writes liveBuilds/{buildSessionId}.recap.
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { paths } from '@/lib/firebase/schema';
import { sanitizeDemoRecap } from '@/lib/liveBuild';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const { companyId, token } = (body ?? {}) as { companyId?: string; token?: string };
  if (!companyId || !token) {
    return NextResponse.json({ error: 'missing companyId or token' }, { status: 400 });
  }
  const db = adminDb();
  const companyRef = db.doc(paths.company(companyId));
  const snap = await companyRef.get();
  const ingestToken = snap.exists ? (snap.data()?.ingestToken as string | undefined) : undefined;
  if (!ingestToken || token !== ingestToken) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const clean = sanitizeDemoRecap(body);
  if (!clean) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const ref = db.doc(paths.liveBuild(companyId, clean.buildSessionId));
  await db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    const prev = (cur.exists ? (cur.data()?.recap as Partial<typeof clean.recap>) : null) ?? {};
    tx.set(ref, { recap: { ...prev, ...clean.recap } }, { merge: true });
  });
  return NextResponse.json({ ok: true });
}
