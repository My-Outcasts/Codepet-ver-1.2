# Second Brain rebuild — Spec #1 (P0 event ledger + P1 derived graph)

**Codepet · Design Spec** — _Approved for implementation_
Date: 2026-07-09 · Owner: Overview / Second Brain
Source design doc: `~/Downloads/second-brain-rebuild.md` (approach doc, P0–P3)

---

## 0 · Scope of this spec

The full vision (P0 event ledger → P1 derived graph → P2 recall → P3 timeline) ships as
**four sequential, independently-mergeable specs**. This spec covers **Spec #1 = P0 + P1**:
turn the structured records we already keep into a connected memory (P0) and make the Second
Brain view a window onto that real graph instead of a static org chart (P1).

P2 (recall / Voyage embeddings) and P3 (timeline / polish) each get their own
brainstorm → spec → plan cycle later. They are **out of scope here** except where a P0
decision must not foreclose them (noted inline).

**The payoff of this spec:** the Second Brain view renders a dense "galaxy" of _real,
cross-linked_ knowledge — deliverables, decisions, facts, build sessions, tasks — like the
Chitti OS reference, not the authored `company → 8 depts → tasks` tree it draws today.

### Decisions locked in brainstorming

| Question                | Decision                                                                         |
| ----------------------- | -------------------------------------------------------------------------------- |
| How far this build goes | Full P0→P3 vision, as 4 sequential specs; **this spec = P0+P1**                  |
| Ledger population       | **Write-through going forward + one-time backfill** (real brain day one)         |
| Where derivation runs   | **Client-side, in-memory** pure function (cache on server later only if slow)    |
| Embedding provider (P2) | Voyage — _decided but not used until Spec #2_                                    |
| Keep dept/task nodes?   | **Yes** — company/department/task stay as the spine; new node types attach to it |
| Feature flag            | **Yes** — gate the view swap behind `NEXT_PUBLIC_SECOND_BRAIN_V2`                |
| Backfill trigger        | **Manual admin route**, called once (not lazy-on-first-open)                     |

---

## 1 · Current state

- Second Brain = `components/views/OverviewView.tsx` (~1270 lines): a `ForceGraph3D` + bloom
  scene. Its graph builder is a `useMemo` (lines ~250–336) that emits `project → DEPTS →
tasks` from the **static** `DEPTS` array in `lib/data.ts`. Structure is authored, not earned.
- `GNode.kind` is `'project' | 'dept' | 'task'`; `GLink.kind` is `'pd' | 'dt'`.
- `lib/store.tsx` already hydrates `library`, `decisions`, and DEPTS/ENV to client state once
  the company is known (lines ~616–633) — so **client-side derivation has its inputs in memory**.
- Firestore writes go through REST helpers (`lib/firebase/firestoreRest.ts`,
  `serverDecisions.ts`) — fail-open, never throw.
- `components/views/DepartmentDetail.tsx` is the existing node-detail panel pattern.
- Precedent for server-gated features: `AI_MEMORY_ENABLED` (see `lib/ai/remember.ts`).

### Structural gaps this spec closes

1. **No timeline** — task state is timestamp-less `done`/`drafted` booleans. P0 adds real `ts`.
2. **No connected knowledge** — library/decisions/facts/sessions never enter the graph. P1 does.
   (The _semantic_ layer — embeddings — is deliberately deferred to Spec #2.)

---

## 2 · P0 — Event ledger

### 2.1 Collection & schema

New append-only subcollection: `companies/{cid}/events/{eventId}`.

```ts
interface LedgerEvent {
  ts: number; // ms epoch — the timestamp we're missing today
  type:
    | 'deliverable_approved'
    | 'decision_made'
    | 'fact_remembered'
    | 'task_run'
    | 'build_session'
    | 'toolkit_used'
    | 'stage_advanced';
  actor: 'byte' | 'founder';
  deptK?: string; // owning department key (optional)
  refType?: string; // 'library' | 'decision' | 'trackEvent' | 'task' | ...
  refId?: string; // pointer back to the source record
  title: string; // short human line
  summary: string; // one sentence — reserved for P2 embedding & recall
}
```

`summary` is written now (cheap) so Spec #2 can embed it without a backfill of its own.

### 2.2 Writer

New `lib/firebase/serverEvents.ts`, mirroring `serverDecisions.ts`:

- `appendEvent(uid, idToken, event)` — REST `POST` (create) to the `events` subcollection.
- Fail-open: returns `boolean`, never throws; a failed emit must never block the main flow.
- Server-only (no `'use client'`).

### 2.3 Write-through emits

Emit exactly one event at each point where a source record already gets written. **No new
data is invented** — we tap existing write paths:

| Emit site (existing)                     | Event type                                                      | actor                   |
| ---------------------------------------- | --------------------------------------------------------------- | ----------------------- |
| `applyResult` (task produced output)     | `task_run` (+ `deliverable_approved` when a library item lands) | byte                    |
| task `done` flip (`lib/store.tsx` ~1325) | `task_run` (done)                                               | founder/byte per source |
| `advanceStage` (`lib/store.tsx` ~1094)   | `stage_advanced`                                                | founder                 |
| `/api/remember`                          | `decision_made` / `fact_remembered`                             | byte                    |
| envUsage write                           | `toolkit_used`                                                  | founder                 |

**Ownership boundary:** `trackEvents` and `/api/track` are Build Coach territory. The ledger
**reads** from `trackEvents` (in backfill) and does **not** modify that pipeline or its hooks.
Build-session events going forward are derived by reading `trackEvents`, not by patching it.

Each emit is best-effort and wrapped so a ledger failure is swallowed (log only).

### 2.4 One-time backfill

`app/api/second-brain/backfill/route.ts` — admin-invoked once per company:

- Reads existing `library`, `decisions`, `trackEvents`, and done tasks.
- Emits one event per record, with the **best `ts` obtainable from the source** (e.g. a
  library item's own timestamp); where none exists, an approximate/ordered fallback.
- **Idempotent:** writes a `secondBrainBackfilledAt` marker on `companies/{cid}`; a second run
  is a no-op. (Or: dedupe by deterministic event id from `refType:refId`.)

P0 ships with **no visible UI change**; verified by tests + inspecting Firestore.

---

## 3 · P1 — Derived graph

### 3.1 Pure builder

New `lib/overview/knowledgeGraph.ts`, mirroring `roadmapLayout.ts` (pure, tested, no
side-effects):

```ts
buildKnowledgeGraph(events: LedgerEvent[], depts: Dept[], roadmap: ...): {
  nodes: GNode[];
  edges: GLink[];
}
```

**Node kinds** (extend `GNode.kind`):
`company` · `department` · `milestone` (roadmap phases) · `deliverable` · `decision` ·
`fact` · `session` · `task`.

**Edge kinds** (replace `pd`/`dt`):
`belongs_to` (deliverable→dept) · `produced` (task/session→deliverable) · `advances`
(task→milestone) · `depends_on` (task→task) · `references` · `supersedes`
(decision→decision) · `grounds` (fact→work).

**Node weight** = recency + reference count (in-degree). This drives glow/size, giving the
uneven bright-vs-dim "galaxy" look — recent & often-referenced nodes shine.

**The point:** cross-links between decision ↔ deliverable ↔ fact are what make it read as a
brain rather than an org chart. This is the core difference from today's linear
`project→dept→task` builder.

**Layout:** keep the existing Fibonacci-sphere placement, distributed by department cluster,
so the result reads as a dense galaxy rather than a sparse tree.

### 3.2 Spine retention

`company` + `department` + `task` nodes are **kept** as the structural spine. Deliverables,
decisions, facts, and sessions attach to that spine via typed edges. Removing dept/task would
strip context, so we don't.

---

## 4 · P1 — View swap, detail panel, galaxy aesthetic

**Do not rewrite the renderer.** Keep `ForceGraph3D` + bloom in `OverviewView.tsx`. Changes:

1. **Swap the data builder** — replace the `useMemo` at lines ~250–336 with a call to
   `buildKnowledgeGraph(events, DEPTS, roadmap)`. Add `events` to store state, hydrated from
   Firestore like `library`/`decisions`.
2. **Node click → detail panel** — each node points back to its source record: deliverable →
   open the library item; decision → open the decision; session → open the recap; task/dept →
   today's behaviour. Reuse the `DepartmentDetail.tsx` pattern.
3. **Galaxy aesthetic** matching the reference: higher node density, glow scaled by weight,
   bloom pass retained. Task/dept keep the ring-sprite; deliverable/decision/fact render as
   small glowing dots (Chitti-OS style).
4. **Empty-state** for new accounts (no events): show the seed spine + an honest invitation
   ("byte fills this in as you work") — never a blank screen.

### 4.1 Feature flag

The whole swap is gated behind `NEXT_PUBLIC_SECOND_BRAIN_V2`. Off → today's static builder.
On → the derived knowledge graph. Lets us ship dark and flip safely, per the `AI_MEMORY_ENABLED`
precedent.

---

## 5 · Testing

- `lib/overview/knowledgeGraph.test.ts` — unit-test the pure builder like
  `roadmapLayout.test.ts`: given events → assert correct nodes, edges, weights, cross-links,
  and empty-state.
- `serverEvents` + backfill — idempotency (no duplicate events on re-run), correct `ts` from
  source, marker written.
- Write-through — each emit site fires exactly one event of the right type, is fail-open, and
  never blocks the main flow (assert the main path still completes when the emit throws).

---

## 6 · Non-goals (this spec)

- **No embeddings / recall / "Ask your Second Brain."** That is Spec #2 (P2). We only write the
  `summary` field now so #2 needs no re-backfill.
- **No timeline view / filters / weight tuning.** Spec #3 (P3).
- **No screen capture / OCR / audio.** The reference project scrapes because it lacks
  structured data; we have it. Adding capture would be strictly worse.
- **No renderer rewrite.** Keep the 3D force-graph + bloom; change only the data feeding it.
- **No changes to `trackEvents` / `/api/track`.** Build Coach territory — read-only for us.
- **No dedicated vector infra.** N/A this spec (and brute-force cosine suffices in #2).

---

## 7 · Deferred to later specs

- **Spec #2 (P2):** Voyage embedding pipeline over `event.summary`; retrieval route
  (brute-force cosine, one-founder scale); byte `recall` tool citing graph nodes; "Ask your
  Second Brain" affordance. Likely behind its own flag until proven.
- **Spec #3 (P3):** scrollable ledger ("what changed this week"), dept/type filters, node-weight
  tuning, clustering, richer empty-states.

---

_Spec #1 of the Second Brain rebuild. Locks P0 schema + P1 view swap. P2/P3 follow as their own
cycles._
