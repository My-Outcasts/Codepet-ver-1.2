// Semantic recall over the event ledger: embed the founder's question, cosine-rank the events,
// and return the top hits with their source pointers so byte / the UI can cite exact graph nodes.
// Auth-gated, read-only, and inert unless the recall feature is on.
import { verifyIdToken, adminDb } from '@/lib/firebase/admin';
import { paths } from '@/lib/firebase/schema';
import type { LedgerEvent } from '@/lib/firebase/schema';
import { isEmbedEnabled, embedTexts } from '@/lib/ai/embed';
import { topK, type RecallItem } from '@/lib/overview/recall';

export async function POST(req: Request) {
  const authz = req.headers.get('authorization') ?? '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  if (!idToken) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (!isEmbedEnabled()) return Response.json({ enabled: false, hits: [] });

  let uid: string;
  try {
    uid = (await verifyIdToken(idToken)).uid;
  } catch {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { query } = (await req.json().catch(() => ({}))) as { query?: string };
  if (!query?.trim()) return Response.json({ enabled: true, hits: [] });

  const [qvec] = await embedTexts([query]);
  const db = adminDb();
  const snap = await db.collection(paths.events(uid)).get();
  const items: RecallItem[] = snap.docs.map((d) => {
    const e = d.data() as LedgerEvent;
    return { refType: e.refType, refId: e.refId, title: e.title, summary: e.summary, vec: e.vec };
  });
  const hits = topK(qvec, items, 6).map(({ refType, refId, title, summary, score }) => ({
    refType,
    refId,
    title,
    summary,
    score,
  }));
  return Response.json({ enabled: true, hits });
}
