# Second Brain — feature-area spine (auto-clustered), Phase A

**Date:** 2026-07-13
**Scope:** `SECOND_BRAIN_V2` galaxy only. Replaces the fixed 8-department spine with
auto-derived, auto-named **feature-area clusters**. No change to the non-v2 Overview.

## Goal

Stop organizing the Second Brain galaxy by corporate departments (eng/mkt/ops/…) —
which are meaningless for a solo founder — and instead let the map's clusters
**emerge automatically from the content** of the work. Each cluster is a named
"feature area" (a sub-nebula); knowledge nodes group by semantic similarity, not by
an authored department. This is the foundation for later phases (B: cinematic zoom
into a cluster; C: open a star to full content + how-it-works + ask-anything).

Product framing (decided in brainstorming): **one product = the universe, feature
areas = the galaxies.** Multi-product is explicitly out. Clustering is fully
automatic (byte auto-clusters by content); user-defined/curated areas are out of
this phase.

## Current state (grounded in code)

- `lib/overview/knowledgeGraph.ts` → `buildKnowledgeGraph(events, depts)`:
  - Spine: a `company` node + one `department`-kind node per `Dept` (`id = dept:${k}`).
  - Each ledger event becomes a knowledge node `id = ev:${refType ?? type}:${refId ?? ts}`,
    attached to its department via `ev.deptK` (else to `company`).
  - Same-department knowledge nodes are chained with `references` edges (density → the
    cluster reads as a connected web). Weight folds in reference count + recency.
- `components/views/OverviewView.tsx` (the `SECOND_BRAIN_V2` branch of the graph
  `useMemo`, ~L375–427): calls `buildKnowledgeGraph(events, DEPTS)`, anchors each
  department on a spread sphere (`deptPos` keyed by `dept:${k}`), seeds each knowledge
  node inside its department's cloud (keyed by `ev.deptK`), and colors each node by its
  department palette color (`deptColor`, via `DCOL`/`HEX`). Labels are hover-only.
- **Embeddings are usually absent:** `LedgerEvent.vec` is filled only when
  `SECOND_BRAIN_RECALL=1` + `VOYAGE_API_KEY` are set (the embed route). On localhost
  today there are no vectors, so clustering MUST work from text alone and merely
  *upgrade* when real vectors exist.

## Target design

### New pure module: `lib/overview/featureClusters.ts`

```ts
export interface FeatureCluster {
  id: string;          // stable: `cluster:0`, `cluster:1`, … (index order is deterministic)
  label: string;       // heuristic name derived from the cluster's items
  memberKeys: string[]; // knowledge-node ids: `ev:${refType ?? type}:${refId ?? ts}`
}

// Deterministic: same events in → same clusters/labels/order out. No Math.random.
export function clusterEvents(events: LedgerEvent[]): FeatureCluster[];

// Shared node-id scheme so cluster membership matches the graph's node ids exactly.
export function eventNodeId(ev: Pick<LedgerEvent, 'type' | 'refType' | 'refId' | 'ts'>): string;
```

**Vectorizing each event:**
- If `ev.vec` is a non-empty `number[]`, use it (real embedding).
- Else build a **local bag-of-words / TF-IDF vector** from `\`${ev.title} ${ev.summary}\``:
  lowercase, split on non-alphanumerics, drop stopwords + tokens < 3 chars, weight by
  TF-IDF across the event set. This makes clustering work with zero external services.
- All events in one run use the same vectorization mode (all-vec or all-text); if only
  *some* events have `vec`, fall back to text for the whole set so the space is uniform.

**Clustering (deterministic):**
- Process events in a stable order (sorted by `eventNodeId` ascending) so results never
  depend on input order or timing.
- Target cluster count `K = clamp(round(sqrt(N)), 3, 8)` where `N` = number of clustered
  events; if `N <= 3`, `K = 1`. Never more clusters than events.
- Deterministic agglomerative clustering by **cosine similarity**: start each event as its
  own cluster; repeatedly merge the two most-similar clusters (average-linkage; ties broken
  by lowest member `eventNodeId`) until `K` clusters remain. No randomness, no seeds.

**Labeling (heuristic, offline):**
- For each cluster, the label is the **top 1–2 salient shared terms** across its members
  (highest summed TF-IDF, excluding stopwords), title-cased; ties broken alphabetically.
- Fallback when no salient term stands out: the short title of the cluster's highest-weight
  member (by recency; deterministic). Never empty.
- (LLM-quality naming is a later upgrade, out of this phase.)

**Edge cases:**
- `events.length === 0` → returns `[]` (galaxy shows just the company core; the existing
  empty-state invite already covers new accounts).
- Events whose `type` has no knowledge-node kind (e.g. `stage_advanced`, `toolkit_used` if
  not mapped) are excluded from clustering, exactly as `buildKnowledgeGraph` already skips
  them via `KIND_OF`.

### Refactor: `buildKnowledgeGraph(events, clusters)`

Change the second parameter from `depts: Dept[]` to `clusters: FeatureCluster[]`:
- Spine: `company` node + one `department`-kind node **per cluster** (`id = cluster.id`,
  `name = cluster.label`, `weight = 1`). Reusing the `department` kind keeps the renderer
  (hub sizing, aura, hover label) unchanged.
- Each knowledge node attaches to the cluster whose `memberKeys` contains its
  `eventNodeId(ev)`; if none (shouldn't happen for clustered events), attach to `company`.
- Replace all `deptK`-keyed grouping (attachment target + density chaining) with
  cluster-id grouping. Add `clusterId?: string` to `KGNode` (or reuse the existing `deptK`
  field to carry the cluster id — implementer's choice, but pick one and be consistent).
- Density edges: unchanged logic, grouped by cluster instead of department.
- Use `eventNodeId` (the shared helper) for node ids so membership matches.

Update `lib/overview/knowledgeGraph.test.ts` to pass `FeatureCluster[]` and assert the
spine/attachment now follow clusters. `buildKnowledgeGraph` has no other caller.

### Integrate into `OverviewView.tsx` (v2 graph `useMemo`)

- `const clusters = clusterEvents(events);`
- `const kg = buildKnowledgeGraph(events, clusters);`
- Positioning: anchor each **cluster hub** on the spread sphere (replace `deptNodes`/
  `deptPos` keyed by `dept:${k}` with cluster hubs keyed by `cluster.id`); seed each
  knowledge node inside its cluster's cloud (its home = the cluster id carried on the node,
  not `ev.deptK`).
- Color: assign each cluster a palette color by cluster index, cycling the existing `HEX`
  values (blue / clay / teal / gold / violet / accent / rose). The hub and all its member
  nodes take that color via `deptColor` (the field `nodeThreeObject` already reads). Root
  stays `#FFE7A8`.
- `DEPTS`/`DCOL` are no longer used to build or color the v2 galaxy. Leave `DEPTS` imported
  only if still needed elsewhere in the file; remove the import if it becomes unused.

## Data flow

No new persisted data, no schema change, no backend. Clustering is derived on the client
from the already-loaded `events` (with their optional `vec`). Everything is recomputed in
the existing `useMemo` keyed on `events`.

## Out of scope (later phases)

- **B:** clicking/zooming a cluster to fly into its own galaxy (cinematic zoom).
- **C:** opening a star to its full content, a "how it works" memory type, and the
  ask-anything panel wired to clusters.
- LLM-based cluster naming.
- Any user-defined / editable feature areas (rename / merge / split).
- Persisting clusters (they are recomputed each load).

## Success criteria

- With `NEXT_PUBLIC_SECOND_BRAIN_V2=1` and real ledger events, the galaxy shows **named
  feature-area clusters** (not department names), each a distinct color, with related items
  grouped together — and it works on localhost with **no** embedding keys set.
- Clusters/labels/positions are **stable** across reloads for the same data (deterministic).
- `npm run typecheck`, `npm run lint` (no new errors), and `npm test` (incl. updated
  `knowledgeGraph.test.ts` + new `featureClusters.test.ts`) all pass.
- Non-v2 Overview is unchanged.
