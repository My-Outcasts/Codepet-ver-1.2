# Second Brain Phase A — Feature-Area Auto-Clustering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Second Brain galaxy's fixed 8-department spine with named feature-area clusters derived automatically from event content.

**Architecture:** A new pure module (`lib/overview/featureClusters.ts`) clusters ledger events by content similarity (real `vec` embeddings when present, else a local TF-IDF over title+summary) into named clusters. `buildKnowledgeGraph` is refactored to build its spine from those clusters instead of `Dept[]`. `OverviewView`'s v2 graph `useMemo` computes clusters, feeds them in, positions/colors each cluster. Deterministic, client-side, no schema/backend change. v2-only; classic Overview untouched.

**Tech Stack:** TypeScript, Vitest (`npm test`), Next.js/React (inline-styled view). Pure logic is TDD; the React integration is verified by typecheck + lint + build + a visual run.

## Global Constraints

- Change **only** `SECOND_BRAIN_V2 === true` behavior. Non-v2 Overview must render exactly as before.
- Fully **deterministic**: same events in → identical clusters, labels, order out. No `Math.random`, no `Date.now`; order must not depend on input array order.
- Must work with **no embeddings** (`VOYAGE_API_KEY` unset): fall back to local TF-IDF text similarity.
- Cluster count: `K = 1` when `n ≤ 3`, else `K = clamp(round(sqrt(n)), 2, 8)`. (This refines the spec's approximate "3–8" to a min of 2 so small sets don't over-split; `n` = number of clustered knowledge events.)
- Node-id scheme is shared: `eventNodeId(ev) = \`ev:${ev.refType ?? ev.type}:${ev.refId ?? ev.ts}\`` — identical to the id `buildKnowledgeGraph` already uses, so cluster membership matches graph nodes exactly.
- Knowledge event types (mirror `KIND_OF` in `knowledgeGraph.ts`): `deliverable_approved`, `decision_made`, `fact_remembered`, `task_run`, `build_session`, `stage_advanced`.
- Keep the build clean: `npm run typecheck` + `npm run lint` introduce no new errors (the repo has ~pre-existing `no-explicit-any`); `npm test` passes.

## File Structure

- **Create** `lib/overview/featureClusters.ts` — pure clustering: `eventNodeId`, `FeatureCluster`, `clusterEvents`.
- **Create** `lib/overview/featureClusters.test.ts` — unit tests.
- **Modify** `lib/overview/knowledgeGraph.ts` — `buildKnowledgeGraph(events, clusters)`: spine + attachment + density from clusters; drop `Dept` import.
- **Modify** `lib/overview/knowledgeGraph.test.ts` — pass `FeatureCluster[]`.
- **Modify** `components/views/OverviewView.tsx` — v2 `useMemo`: compute clusters, feed them in, position + color per cluster.

---

### Task 1: `featureClusters.ts` — deterministic content clustering (TDD)

**Files:**
- Create: `lib/overview/featureClusters.ts`
- Test: `lib/overview/featureClusters.test.ts`

**Interfaces:**
- Produces (later tasks consume these exact signatures):
  - `export function eventNodeId(ev: Pick<LedgerEvent,'type'|'refType'|'refId'|'ts'>): string`
  - `export interface FeatureCluster { id: string; label: string; memberKeys: string[] }`
  - `export function clusterEvents(events: LedgerEvent[]): FeatureCluster[]`

- [ ] **Step 1: Write the failing tests**

Create `lib/overview/featureClusters.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { clusterEvents, eventNodeId, type FeatureCluster } from './featureClusters';
import type { LedgerEvent } from '@/lib/firebase/schema';

const ev = (
  type: LedgerEvent['type'],
  refId: string,
  title: string,
  summary: string,
  ts = 1,
  extra: Partial<LedgerEvent> = {},
): LedgerEvent => ({
  ts,
  type,
  actor: 'byte',
  refType: type === 'deliverable_approved' ? 'library' : 'decision',
  refId,
  title,
  summary,
  ...extra,
});

describe('eventNodeId', () => {
  it('uses refType:refId when present', () => {
    expect(eventNodeId({ type: 'decision_made', refType: 'decision', refId: 'x', ts: 9 })).toBe(
      'ev:decision:x',
    );
  });
  it('falls back to type:ts when refType/refId are absent', () => {
    expect(eventNodeId({ type: 'task_run', ts: 42 })).toBe('ev:task_run:42');
  });
});

describe('clusterEvents', () => {
  it('returns no clusters for no events', () => {
    expect(clusterEvents([])).toEqual([]);
  });

  it('returns a single cluster for 3 or fewer events', () => {
    const out = clusterEvents([
      ev('deliverable_approved', 'a', 'Payment page', 'checkout billing stripe'),
      ev('decision_made', 'b', 'Onboarding', 'welcome signup flow'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].memberKeys).toHaveLength(2);
  });

  it('is deterministic regardless of input order', () => {
    const items = [
      ev('deliverable_approved', 'p1', 'Payment page', 'checkout billing stripe payment'),
      ev('deliverable_approved', 'p2', 'Payment refunds', 'refund billing stripe payment'),
      ev('decision_made', 'p3', 'Payment provider', 'chose stripe for payment billing'),
      ev('deliverable_approved', 'o1', 'Onboarding welcome', 'welcome signup onboarding flow'),
      ev('decision_made', 'o2', 'Onboarding steps', 'signup onboarding welcome steps'),
      ev('task_run', 'o3', 'Onboarding copy', 'welcome onboarding signup copy'),
    ];
    const a = clusterEvents(items);
    const b = clusterEvents([...items].reverse());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('groups semantically-similar events and names the cluster from shared terms', () => {
    const out = clusterEvents([
      ev('deliverable_approved', 'p1', 'Payment page', 'checkout billing stripe payment'),
      ev('deliverable_approved', 'p2', 'Payment refunds', 'refund billing stripe payment'),
      ev('decision_made', 'p3', 'Payment provider', 'chose stripe for payment billing'),
      ev('deliverable_approved', 'o1', 'Onboarding welcome', 'welcome signup onboarding flow'),
      ev('decision_made', 'o2', 'Onboarding steps', 'signup onboarding welcome steps'),
      ev('task_run', 'o3', 'Onboarding copy', 'welcome onboarding signup copy'),
    ]);
    expect(out).toHaveLength(2);
    // Each cluster's 3 members all share a topic.
    const keysOf = (label: string) =>
      out.find((c) => c.label.toLowerCase().includes(label))?.memberKeys ?? [];
    expect(keysOf('payment')).toHaveLength(3);
    expect(keysOf('onboarding')).toHaveLength(3);
  });

  it('uses real embeddings when every event has a vec', () => {
    const withVec = (refId: string, vec: number[]): LedgerEvent =>
      ev('deliverable_approved', refId, refId, refId, 1, { vec });
    const out = clusterEvents([
      withVec('a', [1, 0]),
      withVec('b', [0.98, 0.02]),
      withVec('c', [0, 1]),
      withVec('d', [0.02, 0.98]),
      withVec('e', [0.95, 0.05]),
      withVec('f', [0.05, 0.95]),
    ]);
    expect(out).toHaveLength(2);
    // a,b,e cluster together; c,d,f cluster together (by vector direction).
    const cluster = (k: string) => out.find((c) => c.memberKeys.includes(`ev:library:${k}`));
    expect(cluster('a')).toBe(cluster('b'));
    expect(cluster('a')).toBe(cluster('e'));
    expect(cluster('c')).toBe(cluster('d'));
    expect(cluster('a')).not.toBe(cluster('c'));
  });

  it('skips non-knowledge event types (e.g. toolkit_used)', () => {
    const out = clusterEvents([
      ev('deliverable_approved', 'a', 'X', 'x'),
      { ts: 2, type: 'toolkit_used', actor: 'byte', title: 'tool', summary: 'used a tool' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].memberKeys).toEqual(['ev:library:a']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/overview/featureClusters.test.ts`
Expected: FAIL — `Cannot find module './featureClusters'`.

- [ ] **Step 3: Write the implementation**

Create `lib/overview/featureClusters.ts`:

```ts
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
  'the','and','for','with','that','this','from','into','your','you','are','was','had',
  'has','have','will','not','but','all','can','out','our','use','used','via','its','it',
  'a','an','of','to','in','on','is','be','by','as','at','or','we','so','up','the',
  'byte','company','project','new','set','get','add','fix','make','made','page',
]);

export interface FeatureCluster {
  id: string;
  label: string;
  memberKeys: string[];
}

export function eventNodeId(
  ev: Pick<LedgerEvent, 'type' | 'refType' | 'refId' | 'ts'>,
): string {
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
  let dot = 0, na = 0, nb = 0;
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
  const lowKey = (idxs: number[]) => idxs.map((i) => items[i].key).sort()[0];
  let clusters = items.map((_, i) => [i]);
  while (clusters.length > K) {
    let bestI = 0, bestJ = 1, bestSim = -Infinity, bestKey = '￿';
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        let s = 0;
        for (const a of clusters[i]) for (const b of clusters[j]) s += sim(a, b);
        s /= clusters[i].length * clusters[j].length;
        const mergedKey = lowKey(clusters[i].concat(clusters[j]));
        if (s > bestSim + 1e-12 || (Math.abs(s - bestSim) <= 1e-12 && mergedKey < bestKey)) {
          bestSim = s; bestI = i; bestJ = j; bestKey = mergedKey;
        }
      }
    }
    clusters[bestI] = clusters[bestI].concat(clusters[bestJ]);
    clusters.splice(bestJ, 1);
  }

  // 6. Deterministic cluster order (by lowest member key).
  clusters.sort((c1, c2) => (lowKey(c1) < lowKey(c2) ? -1 : 1));

  // 7. Label + emit.
  return clusters.map((idxs, ci) => ({
    id: `cluster:${ci}`,
    label: labelFor(idxs, items, tokens),
    memberKeys: idxs.map((i) => items[i].key).sort(),
  }));
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
  if (shared.length > 0) return shared.slice(0, 2).map(([t]) => titleCase(t)).join(' & ');
  // Fallback: the newest member's title (deterministic tie-break by node key).
  const newest = idxs
    .map((i) => items[i])
    .sort((a, b) => b.ev.ts - a.ev.ts || (a.key < b.key ? -1 : 1))[0];
  return shorten(newest.ev.title);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/overview/featureClusters.test.ts`
Expected: PASS — all cases green, output pristine.

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npx eslint lib/overview/featureClusters.ts lib/overview/featureClusters.test.ts`
Expected: typecheck clean; no new eslint errors.

- [ ] **Step 6: Commit**

```bash
git add lib/overview/featureClusters.ts lib/overview/featureClusters.test.ts
git commit -m "feat(second-brain): pure deterministic feature-area clustering (vec or local TF-IDF)"
```

---

### Task 2: Refactor `buildKnowledgeGraph` to build the spine from clusters

**Files:**
- Modify: `lib/overview/knowledgeGraph.ts`
- Test: `lib/overview/knowledgeGraph.test.ts`

**Interfaces:**
- Consumes: `FeatureCluster` and `eventNodeId` from Task 1 (`./featureClusters`).
- Produces: `buildKnowledgeGraph(events: LedgerEvent[], clusters: FeatureCluster[]): { nodes: KGNode[]; edges: KGEdge[] }`. Cluster hubs are `department`-kind nodes with `id = cluster.id`, `name = cluster.label`; each knowledge node carries its cluster id on `KGNode.deptK`.

- [ ] **Step 1: Update the tests first**

Rewrite `lib/overview/knowledgeGraph.test.ts` to pass clusters instead of `DEPTS`. Replace every `buildKnowledgeGraph(events, DEPTS)`-style call. Example structure (adapt existing assertions to cluster ids/labels):

```ts
import { describe, it, expect } from 'vitest';
import { buildKnowledgeGraph } from './knowledgeGraph';
import type { FeatureCluster } from './featureClusters';
import type { LedgerEvent } from '@/lib/firebase/schema';

const evs: LedgerEvent[] = [
  { ts: 3, type: 'deliverable_approved', actor: 'byte', refType: 'library', refId: 'L1', title: 'API v1', summary: 'Approved API v1.' },
  { ts: 2, type: 'decision_made', actor: 'byte', refType: 'decision', refId: 'Voyage', title: 'Use Voyage', summary: 'Decision: use Voyage.' },
];
const clusters: FeatureCluster[] = [
  { id: 'cluster:0', label: 'Api', memberKeys: ['ev:library:L1'] },
  { id: 'cluster:1', label: 'Voyage', memberKeys: ['ev:decision:Voyage'] },
];

describe('buildKnowledgeGraph (cluster spine)', () => {
  it('adds a company node and one department-kind hub per cluster', () => {
    const { nodes } = buildKnowledgeGraph(evs, clusters);
    expect(nodes.find((n) => n.id === 'company')).toBeTruthy();
    const hubs = nodes.filter((n) => n.kind === 'department');
    expect(hubs.map((h) => h.id).sort()).toEqual(['cluster:0', 'cluster:1']);
    expect(hubs.find((h) => h.id === 'cluster:0')?.name).toBe('Api');
  });

  it('attaches each knowledge node to its cluster hub', () => {
    const { nodes, edges } = buildKnowledgeGraph(evs, clusters);
    const api = nodes.find((n) => n.id === 'ev:library:L1')!;
    expect(api.deptK).toBe('cluster:0');
    expect(edges.some((e) => e.source === 'ev:library:L1' && e.target === 'cluster:0')).toBe(true);
  });

  it('attaches to company when an event is in no cluster', () => {
    const { edges } = buildKnowledgeGraph(evs, [
      { id: 'cluster:0', label: 'Api', memberKeys: ['ev:library:L1'] },
    ]);
    expect(edges.some((e) => e.source === 'ev:decision:Voyage' && e.target === 'company')).toBe(true);
  });
});
```

Keep any pre-existing assertions that don't depend on departments (dedupe of dangling edges, recency weighting, etc.), adapting ids as needed.

- [ ] **Step 2: Run to verify the tests fail**

Run: `npx vitest run lib/overview/knowledgeGraph.test.ts`
Expected: FAIL — signature/`deptK` mismatches (the old `depts` param is gone).

- [ ] **Step 3: Refactor `buildKnowledgeGraph`**

In `lib/overview/knowledgeGraph.ts`:

Replace the import of `Dept`:
```ts
// remove: import type { Dept } from '@/lib/data';
import { eventNodeId, type FeatureCluster } from './featureClusters';
```

Change the signature and spine (replace the current `depts` parameter and the department spine loop):
```ts
export function buildKnowledgeGraph(
  events: LedgerEvent[],
  clusters: FeatureCluster[],
): { nodes: KGNode[]; edges: KGEdge[] } {
  const nodes: KGNode[] = [];
  const edges: KGEdge[] = [];
  const seen = new Set<string>();
  const inDegree = new Map<string, number>();
  const bump = (id: string) => inDegree.set(id, (inDegree.get(id) ?? 0) + 1);

  // Spine: company + one hub per feature-area cluster (reuse the 'department' kind so the
  // renderer's hub styling is unchanged). Map each member key → its cluster id.
  nodes.push({ id: 'company', name: 'Your company', kind: 'company', weight: 10 });
  seen.add('company');
  const clusterIds = new Set<string>();
  const clusterOf = new Map<string, string>();
  for (const c of clusters) {
    nodes.push({ id: c.id, name: c.label, kind: 'department', weight: 1, deptK: c.id });
    seen.add(c.id);
    clusterIds.add(c.id);
    edges.push({ source: 'company', target: c.id, kind: 'spine' });
    for (const k of c.memberKeys) clusterOf.set(k, c.id);
  }
```

Change knowledge-node creation to use `eventNodeId`, carry the cluster id on `deptK`, and attach to the cluster:
```ts
  const sorted = [...events].sort((a, b) => b.ts - a.ts);
  sorted.forEach((ev, i) => {
    const kind = KIND_OF[ev.type];
    if (!kind) return;
    const id = eventNodeId(ev);
    if (seen.has(id)) return;
    seen.add(id);
    const clusterId = clusterOf.get(id);
    nodes.push({
      id,
      name: ev.title,
      kind,
      weight: recencyWeight(i, sorted.length),
      deptK: clusterId, // carries the cluster id (renderer reads deptK as the node's home)
      refType: ev.refType,
      refId: ev.refId,
      ts: ev.ts,
    });
    const target = clusterId && clusterIds.has(clusterId) ? clusterId : 'company';
    edges.push({ source: id, target, kind: EDGE_OF[ev.type] ?? 'references' });
    bump(target);
  });
```

Change the density-chaining grouping from `byDept` (keyed on department) to group by the cluster id now stored on `deptK` — the existing loop already reads `n.deptK`, so only the comment needs updating; the grouping key is now the cluster id. Leave `REFERENCES_CAP`, `recencyWeight`, weight-folding, and edge logic unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/overview/knowledgeGraph.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass (Task 1 + Task 2 suites green).

- [ ] **Step 6: Commit**

```bash
git add lib/overview/knowledgeGraph.ts lib/overview/knowledgeGraph.test.ts
git commit -m "refactor(second-brain): knowledge graph spine from feature clusters, not departments"
```

---

### Task 3: Wire clusters into the v2 galaxy in `OverviewView.tsx`

**Files:**
- Modify: `components/views/OverviewView.tsx`

**Interfaces:**
- Consumes: `clusterEvents` (Task 1) and the cluster-based `buildKnowledgeGraph` (Task 2). Cluster hubs arrive as `kind === 'department'` nodes with `id === 'cluster:N'`; knowledge nodes carry their cluster id on `deptK`.
- Produces: the v2 galaxy positions/colors clusters (no department dependency). No unit test — verified by typecheck + lint + build + a visual run.

- [ ] **Step 1: Import `clusterEvents`**

Add near the other `@/lib/overview/...` imports:
```ts
import { clusterEvents } from '@/lib/overview/featureClusters';
```

- [ ] **Step 2: Build the graph from clusters + assign per-cluster colors**

In the `SECOND_BRAIN_V2` branch of the `useMemo` (currently `const kg = buildKnowledgeGraph(events, DEPTS);`), replace with:
```ts
      const clusters = clusterEvents(events);
      const kg = buildKnowledgeGraph(events, clusters);
      // One palette color per cluster (cycled), keyed by cluster id.
      const PALETTE = Object.values(HEX); // blue, clay, teal, gold, violet, accent, rose
      const clusterColor = new Map<string, string>(
        clusters.map((c, i) => [c.id, PALETTE[i % PALETTE.length]]),
      );
```

- [ ] **Step 3: Position cluster hubs (the `deptPos` block is now keyed by cluster id)**

The existing `deptNodes`/`deptPos` block already selects `kind === 'department'` nodes and keys `deptPos` by `d.id`. Since cluster hubs are `department`-kind with `id === 'cluster:N'`, **no change is needed to the positioning math** — it now anchors cluster hubs. (Leave the block as-is; optionally update its comment from "departments" to "clusters".)

- [ ] **Step 4: Color nodes by cluster, and seed knowledge nodes inside their cluster cloud**

Replace the color logic (the `dk`/`deptHex`/`hex` lines) with cluster-color lookup:
```ts
        const hex =
          n.kind === 'department'
            ? (clusterColor.get(n.id) ?? '#FDB022')
            : (clusterColor.get(n.deptK ?? '') ?? KG_HEX[n.kind] ?? HEX['--accent']);
```

Replace the knowledge-node home lookup (currently prefixes `dept:`) so it uses the cluster id directly:
```ts
        // Knowledge node: seed inside its cluster's cloud; cluster-less nodes form a central halo.
        const homeId = n.deptK && deptPos.has(n.deptK) ? n.deptK : null;
```
(The rest of the seeding math — `c`, `key`, `ci`, `R`, golden-angle spread — is unchanged.)

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npx eslint components/views/OverviewView.tsx`
Expected: typecheck clean; no new eslint errors. (If `DEPTS`/`DCOL` are now unused anywhere in the file, remove them from the import; if still used — e.g. `nextStepDept` uses `DEPTS`, the non-v2 branch uses `DCOL` — keep them.)

- [ ] **Step 6: Build + visual verification**

Run: `npm run build` (expect success), then:
```bash
NEXT_PUBLIC_SECOND_BRAIN_V2=1 npm run dev
```
On the Second Brain screen with a company that has events: the galaxy groups into **named feature-area clusters** (not department names), each a distinct color, related items together. Hover a hub → its cluster label. Reload → same layout (deterministic). No console errors.

- [ ] **Step 7: Commit**

```bash
git add components/views/OverviewView.tsx
git commit -m "feat(second-brain): galaxy clusters by auto-derived feature areas, not departments"
```

---

## Final verification

- [ ] `npm run typecheck && npm run lint && npm test && npm run build` — all pass; no new lint errors; `featureClusters.test.ts` + `knowledgeGraph.test.ts` green.
- [ ] With `NEXT_PUBLIC_SECOND_BRAIN_V2=1`: clusters are named feature areas, colored distinctly, deterministic across reloads, and work with **no** embedding keys set (local TF-IDF path).
- [ ] With `NEXT_PUBLIC_SECOND_BRAIN_V2` unset: Overview unchanged.

## Self-Review Notes

- **Spec coverage:** new `featureClusters.ts` with `clusterEvents`/`eventNodeId` (T1); vec-or-TF-IDF vectorization, deterministic agglomerative clustering, heuristic labeling, K formula, empty/small-set handling (T1); `buildKnowledgeGraph(events, clusters)` spine/attachment/density (T2); OverviewView positioning + per-cluster color + no-department (T3). Covered.
- **Placeholder scan:** none — every step has concrete code.
- **Type consistency:** `eventNodeId`/`FeatureCluster` defined in T1 and consumed verbatim in T2/T3; `deptK` reused to carry the cluster id consistently across T2 (set) and T3 (read); cluster hub ids `cluster:N` are `department`-kind so the renderer is untouched.
- **K note:** the plan uses min-2 (`clamp(round(sqrt(n)),2,8)`) vs the spec's approximate "3"; flagged in Global Constraints as an intentional refinement for small sets.
