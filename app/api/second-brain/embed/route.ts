// Lazily embed the event ledger: fill `vec` on any events that lack one, so recall has vectors
// to search. Idempotent (only missing events), auth-gated, and inert unless the recall feature
// is on (SECOND_BRAIN_RECALL=1 + VOYAGE_API_KEY). Reads/writes only the events subcollection.
import { verifyIdToken, adminDb } from '@/lib/firebase/admin';
import { paths } from '@/lib/firebase/schema';
import { isEmbedEnabled, embedTexts } from '@/lib/ai/embed';

export async function POST(req: Request) {
  const authz = req.headers.get('authorization') ?? '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  if (!idToken) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (!isEmbedEnabled()) return Response.json({ enabled: false, embedded: 0 });

  let uid: string;
  try {
    uid = (await verifyIdToken(idToken)).uid;
  } catch {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = adminDb();
  const snap = await db.collection(paths.events(uid)).get();
  const missing = snap.docs.filter((d) => !Array.isArray(d.get('vec')));
  if (missing.length === 0) return Response.json({ enabled: true, embedded: 0 });

  const vectors = await embedTexts(
    missing.map((d) => String(d.get('summary') ?? d.get('title') ?? '')),
  );
  const batch = db.batch();
  missing.forEach((d, i) => batch.set(d.ref, { vec: vectors[i] }, { merge: true }));
  await batch.commit();

  return Response.json({ enabled: true, embedded: missing.length });
}
