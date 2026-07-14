// Server-side retrieval augmentation for byte's chat: when recall is enabled, pull the ledger
// events most relevant to the founder's latest message and hand them to byte as prompt context,
// so answers are grounded in what actually happened. Best-effort — any failure yields an empty
// block and chat proceeds unchanged. This is the safe alternative to a streaming tool round-trip.
import { adminDb } from '../firebase/admin';
import { paths } from '../firebase/schema';
import type { LedgerEvent } from '../firebase/schema';
import { isEmbedEnabled, embedTexts } from './embed';
import { topK, formatRecallBlock, type RecallItem } from '../overview/recall';

export async function recallBlock(uid: string, query: string): Promise<string> {
  if (!isEmbedEnabled() || !query.trim()) return '';
  try {
    const [qvec] = await embedTexts([query]);
    const snap = await adminDb().collection(paths.events(uid)).get();
    const items: RecallItem[] = snap.docs.map((d) => {
      const e = d.data() as LedgerEvent;
      return { refType: e.refType, refId: e.refId, title: e.title, summary: e.summary, vec: e.vec };
    });
    return formatRecallBlock(topK(qvec, items, 6));
  } catch {
    return '';
  }
}
