// Backfill: project the records we already keep (approved deliverables, locked-in decisions,
// completed tasks) into the append-only Second Brain event ledger, so the founder's graph is
// dense with real history. Re-runnable — events are keyed by a deterministic refType:refId, so
// re-running overwrites in place instead of duplicating. Reads only; never touches the Build
// Coach pipeline.
import { verifyIdToken, adminDb } from '@/lib/firebase/admin';
import { paths } from '@/lib/firebase/schema';
import {
  eventKey,
  eventFromLibItem,
  eventFromDecision,
  eventFromTaskDone,
} from '@/lib/overview/ledger';
import type { LedgerEvent, Task, DepartmentDoc } from '@/lib/firebase/schema';
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

  const events: LedgerEvent[] = [];

  // Approved deliverables → deliverable nodes.
  const libSnap = await db.collection(paths.library(uid)).get();
  libSnap.forEach((d) => {
    const data = d.data() as { title?: string; k?: string; createdAt?: number };
    events.push(eventFromLibItem({ id: d.id, title: data.title, k: data.k, createdAt: data.createdAt }));
  });

  // Locked-in decisions → decision nodes.
  const decisions = (companySnap.get('decisions') as DecisionEntry[]) ?? [];
  decisions.forEach((dec) => events.push(eventFromDecision(dec)));

  // Completed tasks across every department → task nodes (the bulk of the galaxy's density).
  const deptSnap = await db.collection(paths.departments(uid)).get();
  let taskTs = Date.now();
  deptSnap.forEach((d) => {
    const dept = d.data() as DepartmentDoc;
    for (const task of (dept.tasks ?? []) as Task[]) {
      if (task.done) events.push(eventFromTaskDone(dept.k, dept.name, task, taskTs--));
    }
  });

  const batch = db.batch();
  for (const ev of events) {
    const id = eventKey(ev.refType ?? 'x', ev.refId ?? String(ev.ts));
    batch.set(db.doc(paths.event(uid, id)), ev);
  }
  batch.set(companyRef, { secondBrainBackfilledAt: Date.now() }, { merge: true });
  await batch.commit();

  return Response.json({ backfilled: events.length, skipped: false });
}
