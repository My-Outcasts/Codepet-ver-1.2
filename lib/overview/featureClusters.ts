// Pure, deterministic feature-area clustering for the Second Brain galaxy. Groups
// ledger events into named "feature areas" by content similarity — using real
// embeddings (ev.vec) when every event has one, else a local TF-IDF over
// title+summary so it works with no external service. No side effects, no
// Firestore, no randomness.
import type { LedgerEvent } from '@/lib/firebase/schema';

// Event types that become knowledge nodes — keep in sync with KIND_OF in knowledgeGraph.ts.
const KNOWLEDGE_TYPES: ReadonlySet<LedgerEvent['type']> = new Set([
  'deliverable_approved',
  'decision_made',
  'fact_remembered',
  'task_run',
  'build_session',
  'stage_advanced',
]);

const STOPWORDS: ReadonlySet<string> = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'your',
  'you',
  'are',
  'was',
  'had',
  'has',
  'have',
  'will',
  'not',
  'but',
  'all',
  'can',
  'out',
  'our',
  'use',
  'used',
  'via',
  'its',
  'it',
  'a',
  'an',
  'of',
  'to',
  'in',
  'on',
  'is',
  'be',
  'by',
  'as',
  'at',
  'or',
  'we',
  'so',
  'up',
  'the',
  'byte',
  'company',
  'project',
  'new',
  'set',
  'get',
  'add',
  'fix',
  'make',
  'made',
  'page',
]);

export interface FeatureCluster {
  id: string;
  label: string;
  memberKeys: string[];
}

export function eventNodeId(ev: Pick<LedgerEvent, 'type' | 'refType' | 'refId' | 'ts'>): string {
  return `ev:${ev.refType ?? ev.type}:${ev.refId ?? ev.ts}`;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function cosineSparse(a: Map<string, number>, b: Map<string, number>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [k, v] of small) {
    const w = large.get(k);
    if (w) dot += v * w;
  }
  let na = 0;
  for (const v of a.values()) na += v * v;
  let nb = 0;
  for (const v of b.values()) nb += v * v;
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

function cosineDense(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function shorten(s: string, max = 24): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

export function clusterEvents(events: LedgerEvent[]): FeatureCluster[] {
  // 1. Knowledge events only, deduped by node key, in a stable (key-sorted) order.
  const seen = new Set<string>();
  const items = events
    .filter((e) => KNOWLEDGE_TYPES.has(e.type))
    .map((e) => ({ ev: e, key: eventNodeId(e) }))
    .filter((it) => (seen.has(it.key) ? false : (seen.add(it.key), true)))
    .sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));

  const n = items.length;
  if (n === 0) return [];

  // 2. Text tokens per item — always computed (used for labels, and for text-mode similarity).
  const tokens = items.map((it) => tokenize(`${it.ev.title} ${it.ev.summary}`));

  // 3. Similarity: real embeddings only when EVERY item has a usable vec; else TF-IDF text.
  const allHaveVec = items.every(
    (it) => Array.isArray(it.ev.vec) && (it.ev.vec as number[]).length > 0,
  );
  let sim: (i: number, j: number) => number;
  if (allHaveVec) {
    const vecs = items.map((it) => it.ev.vec as number[]);
    sim = (i, j) => cosineDense(vecs[i], vecs[j]);
  } else {
    const df = new Map<string, number>();
    for (const toks of tokens) for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);
    const tfidf = tokens.map((toks) => {
      const tf = new Map<string, number>();
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
      const v = new Map<string, number>();
      for (const [t, f] of tf) v.set(t, f * (Math.log((n + 1) / ((df.get(t) ?? 0) + 1)) + 1));
      return v;
    });
    sim = (i, j) => cosineSparse(tfidf[i], tfidf[j]);
  }

  // 4. Target cluster count.
  const K = n <= 3 ? 1 : clamp(Math.round(Math.sqrt(n)), 2, 8);

  // 5. Deterministic average-linkage agglomerative clustering.
  // `minKey[c]` tracks cluster c's lowest member key in lockstep with `clusters`, so the
  // tie-break below doesn't need to re-sort every candidate pair's combined members on
  // every round (that resort dominated runtime for large n) — it's always equal to what
  // `clusters[c].map(i => items[i].key).sort()[0]` would produce.
  const clusters = items.map((_, i) => [i]);
  const minKey = items.map((it) => it.key);
  while (clusters.length > K) {
    let bestI = 0,
      bestJ = 1,
      bestSim = -Infinity,
      bestKey = '￿';
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        let s = 0;
        for (const a of clusters[i]) for (const b of clusters[j]) s += sim(a, b);
        s /= clusters[i].length * clusters[j].length;
        const mergedKey = minKey[i] < minKey[j] ? minKey[i] : minKey[j];
        // 1e-12 epsilon: float-equality tolerance so near-identical similarity scores fall
        // through to the deterministic key tie-break instead of being decided by rounding noise.
        if (s > bestSim + 1e-12 || (Math.abs(s - bestSim) <= 1e-12 && mergedKey < bestKey)) {
          bestSim = s;
          bestI = i;
          bestJ = j;
          bestKey = mergedKey;
        }
      }
    }
    clusters[bestI] = clusters[bestI].concat(clusters[bestJ]);
    minKey[bestI] = minKey[bestI] < minKey[bestJ] ? minKey[bestI] : minKey[bestJ];
    clusters.splice(bestJ, 1);
    minKey.splice(bestJ, 1);
  }

  // 6. Deterministic cluster order (by lowest member key) — reuse `minKey`, no re-sort.
  const order = clusters.map((_, i) => i).sort((a, b) => (minKey[a] < minKey[b] ? -1 : 1));

  // 7. Label + emit.
  return order.map((i, ci) => {
    const idxs = clusters[i];
    return {
      id: `cluster:${ci}`,
      label: labelFor(idxs, items, tokens),
      memberKeys: idxs.map((k) => items[k].key).sort(),
    };
  });
}

function labelFor(
  idxs: number[],
  items: { ev: LedgerEvent; key: string }[],
  tokens: string[][],
): string {
  const score = new Map<string, number>();
  for (const i of idxs) for (const t of tokens[i]) score.set(t, (score.get(t) ?? 0) + 1);
  const shared = [...score.entries()]
    .filter(([, c]) => c >= 2) // a "shared" term appears in the cluster more than once
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  if (shared.length > 0)
    return shared
      .slice(0, 2)
      .map(([t]) => titleCase(t))
      .join(' & ');
  // Fallback: the newest member's title (deterministic tie-break by node key).
  const newest = idxs
    .map((i) => items[i])
    .sort((a, b) => b.ev.ts - a.ev.ts || (a.key < b.key ? -1 : 1))[0];
  return shorten(newest.ev.title);
}
