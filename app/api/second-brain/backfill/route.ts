// One-time backfill: project the records we already keep (approved deliverables,
// locked-in decisions) into the append-only Second Brain event ledger, so a founder
// who has been working for weeks gets a full brain the first time the graph loads.
// Idempotent via a marker on the company doc. Reads only — never mutates the source
// collections, and never touches trackEvents / the Build Coach pipeline.
import { verifyIdToken, adminDb } from '@/lib/firebase/admin';
import { paths } from '@/lib/firebase/schema';
import { eventKey, eventFromLibItem, eventFromDecision } from '@/lib/overview/ledger';
import type { LedgerEvent } from '@/lib/firebase/schema';
import type { DecisionEntry } from '@/lib/ai/projectModel';

export async function POST(req: Request) {
  const authz = req.headers.get('authorization') ?? '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  if (!idToken) return Response.json({ error: 'unauthorized' }, { status: 401 });

  let uid: string;
  try {
    uid = (await verifyIdToken(idToken)).uid;
  } catch {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = adminDb();
  const companyRef = db.doc(paths.company(uid));
  const companySnap = await companyRef.get();
  if (!companySnap.exists) return Response.json({ error: 'no company' }, { status: 404 });
  if (companySnap.get('secondBrainBackfilledAt')) {
    return Response.json({ backfilled: 0, skipped: true });
  }

  const events: LedgerEvent[] = [];

  const libSnap = await db.collection(paths.library(uid)).get();
  libSnap.forEach((d) => {
    const data = d.data() as { title?: string; k?: string; createdAt?: number };
    events.push(eventFromLibItem({ id: d.id, title: data.title, k: data.k, createdAt: data.createdAt }));
  });

  const decisions = (companySnap.get('decisions') as DecisionEntry[]) ?? [];
  decisions.forEach((dec) => events.push(eventFromDecision(dec)));

  const batch = db.batch();
  for (const ev of events) {
    const id = eventKey(ev.refType ?? 'x', ev.refId ?? String(ev.ts));
    batch.set(db.doc(paths.event(uid, id)), ev);
  }
  batch.set(companyRef, { secondBrainBackfilledAt: Date.now() }, { merge: true });
  await batch.commit();

  return Response.json({ backfilled: events.length, skipped: false });
}
