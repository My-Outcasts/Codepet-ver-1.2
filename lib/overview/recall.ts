// Pure brute-force cosine retrieval — enough at one-founder scale (hundreds of events),
// no vector DB. No side effects, fully unit-tested with stub vectors.
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface RecallItem {
  refType?: string;
  refId?: string;
  title: string;
  summary: string;
  vec?: number[];
}

export function topK(
  queryVec: number[],
  items: RecallItem[],
  k: number,
): Array<RecallItem & { score: number }> {
  return items
    .filter((it) => Array.isArray(it.vec) && it.vec.length > 0)
    .map((it) => ({ ...it, score: cosine(queryVec, it.vec as number[]) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
