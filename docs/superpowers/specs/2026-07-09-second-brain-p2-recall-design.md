# Second Brain rebuild — Spec #2 (P2 recall)

**Codepet · Design Spec** — *Approved for implementation*
Date: 2026-07-09 · Owner: Overview / Second Brain
Depends on: Spec #1 (P0 event ledger + P1 graph) — shipped.

---

## 0 · Scope

Add the semantic layer the ledger lacks today: embed each event's `summary`, and let byte
answer "what did we decide about pricing?" by embedding the query, pulling the top-k nearest
events, and citing the exact graph nodes. This is Spec #2 of the four-spec rebuild.

### Decisions (locked in brainstorming)

| Question | Decision |
|---|---|
| Embedding provider | **Voyage** (`voyage-3`) via a provider-agnostic seam |
| Embedding timing | **Lazy, server batch** — a route embeds events missing a vector |
| Vector storage | `vec: number[]` field **on each event doc** (one-founder scale; brute-force cosine) |
| Gating | New server flag `SECOND_BRAIN_RECALL`; inert without it **or** without `VOYAGE_API_KEY` |
| UI affordance | "Ask your Second Brain" on the view (client flag `NEXT_PUBLIC_SECOND_BRAIN_V2`) |
| API key now? | Build against a stub-able seam + tests; live embeddings once `VOYAGE_API_KEY` is set |

**Non-goals:** no dedicated vector DB (brute-force cosine suffices), no re-ranking model, no
streaming recall, no changes to `trackEvents`/Build Coach. P3 (timeline/filters) is separate.

---

## 1 · Components

### 1.1 Embed seam — `lib/ai/embed.ts` (server-only)
- `embedTexts(texts: string[]): Promise<number[][]>` — calls Voyage `POST /v1/embeddings`
  (`model: 'voyage-3'`), batched. Throws if `VOYAGE_API_KEY` is unset (callers guard first).
- `isEmbedEnabled(): boolean` — `!!process.env.VOYAGE_API_KEY && process.env.SECOND_BRAIN_RECALL === '1'`.
- Mirrors `lib/ai/client.ts` server-only posture; never imported into client bundles.

### 1.2 Pure retrieval — `lib/overview/recall.ts`
- `cosine(a: number[], b: number[]): number`
- `topK(queryVec: number[], items: {refType?, refId?, title, summary, vec?: number[]}[], k: number): Array<item & {score:number}>`
  — filters items with a `vec`, ranks by cosine desc, returns top k. Pure, fully unit-tested with
  stub vectors (no key needed).

### 1.3 Vector store
- Extend `LedgerEvent` (schema.ts) with optional `vec?: number[]`.
- Vectors live on the event doc written by Spec #1; no new collection.

### 1.4 Embed route — `app/api/second-brain/embed/route.ts` (POST, auth)
- Verifies ID token; no-op `{ enabled:false }` when `!isEmbedEnabled()`.
- Reads events missing `vec` (admin SDK), embeds their `summary` in batches, writes `vec` back
  (merge). Idempotent — only fills missing vectors. Returns `{ embedded: n }`.

### 1.5 Recall route — `app/api/second-brain/recall/route.ts` (POST, auth)
- Body `{ query: string }`. No-op `{ enabled:false, hits:[] }` when `!isEmbedEnabled()`.
- Embeds the query, loads the company's events, `topK` (k=6), returns
  `{ enabled:true, hits: Array<{refType, refId, title, summary, score}> }`.

### 1.6 byte `recall` tool
- Register a `recall` tool in the chat route's tool set: byte calls it with a query; the route
  runs the same retrieval and feeds hits (title + summary + refId) back so byte answers with
  citations. Guarded by `isEmbedEnabled()` — absent, the tool is not offered.

### 1.7 "Ask your Second Brain" affordance
- On the Second Brain view (when `NEXT_PUBLIC_SECOND_BRAIN_V2`): a small input that POSTs to
  `/api/second-brain/recall` and lists the cited hits; clicking a hit focuses/opens its node
  (reuse the Spec #1 node-click routing by `refType`/`refId`).

---

## 2 · Data flow

```
founder asks ──► /api/second-brain/recall ──► embedTexts([query]) ──► topK(qvec, events) ──► hits
                                                                                   │
byte chat ──► recall tool ──► (same retrieval) ──► citations in the answer ◄───────┘

backfill/new events ──► /api/second-brain/embed ──► fill missing event.vec
```

---

## 3 · Testing

- `lib/overview/recall.test.ts` — `cosine` correctness (identical=1, orthogonal=0), `topK`
  ordering, k-limit, and skipping vec-less items. Stub vectors, no key.
- Embed/recall routes — unit-test the enabled/disabled gate and the "missing vec only" selection
  with a stubbed `embedTexts`. No live Voyage call in tests.

---

## 4 · Rollout / verification

- Feature inert until `SECOND_BRAIN_RECALL=1` **and** `VOYAGE_API_KEY` are set — zero effect on
  current users otherwise.
- Live verification (owner, once a key is set): run `/api/second-brain/embed`, then ask a known
  question via the panel and confirm cited nodes are relevant.

---

*Spec #2 of the Second Brain rebuild. P3 (timeline/filters/polish) follows as its own cycle.*
