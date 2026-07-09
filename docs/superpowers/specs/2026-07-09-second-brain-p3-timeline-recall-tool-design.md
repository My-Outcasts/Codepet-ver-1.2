# Second Brain rebuild — Spec #3 (P3 timeline + P2.1 chat recall)

**Codepet · Design Spec** — *Approved for implementation*
Date: 2026-07-09 · Owner: Overview / Second Brain
Depends on: Spec #1 (P0/P1) + Spec #2 (P2) — shipped.

---

## 0 · Scope

Two additive, flag-gated pieces that finish the Second Brain rebuild vision:

- **P3 · Timeline** — a "what changed" list over the event ledger, on the Second Brain view.
- **P2.1 · Chat recall** — byte answers grounded in the ledger, via server-side retrieval
  augmentation of the chat system prompt (the safe alternative to a streaming tool round-trip).

Both are inert unless their flag is on; with flags off the app is byte-for-byte today's.

### Decisions (sensible defaults, no new external deps)

| Area | Decision |
|---|---|
| Timeline data | Reuse the store's already-hydrated `events` — **client-only**, no new reads |
| Timeline surface | A toggleable panel on the Second Brain view (client flag `NEXT_PUBLIC_SECOND_BRAIN_V2`) |
| Timeline filter | By event type (all / deliverable / decision / milestone / task) |
| Chat recall approach | **Retrieval-augment the system prompt** in `app/api/chat/route.ts` (no client/stream changes) |
| Chat recall gate | `isEmbedEnabled()` (Spec #2) — inert without `SECOND_BRAIN_RECALL` + `VOYAGE_API_KEY` |

**Non-goals:** no new streaming tool, no client chat-UI changes, no node-weight ML tuning, no
new collections, no `trackEvents`/Build Coach changes.

---

## 1 · P3 — Timeline

### 1.1 Pure helper — `lib/overview/timeline.ts`
- `type TimelineFilter = 'all' | 'deliverable' | 'decision' | 'milestone' | 'task'`
- `filterEvents(events: LedgerEvent[], filter: TimelineFilter): LedgerEvent[]` — newest-first,
  filtered by mapping the filter to event types (e.g. `deliverable` → `deliverable_approved`).
- `relativeTime(ts: number, now: number): string` — "just now" / "2h ago" / "3d ago" / "Jul 2".
  Pure (takes `now`), unit-tested.

### 1.2 UI — timeline panel in `OverviewView` (behind `SECOND_BRAIN_V2`)
- A toggle ("Timeline") that opens a right-side scrollable panel listing filtered events: each row
  = type badge + title + relative time. Filter chips at the top.
- Clicking a row routes to the source (reuse Spec #2's `openHit`-style routing by `refType`).
- Empty filter result → a quiet "nothing here yet" line.

---

## 2 · P2.1 — Chat recall (retrieval augmentation)

### 2.1 In `app/api/chat/route.ts`
- After the verified `uid` + latest user message are known, and only when `isEmbedEnabled()`:
  embed the latest user message, load the company's events (`adminDb` → `paths.events(uid)`),
  `topK(qvec, items, 6)`, and format a compact `secondBrainBlock`:
  `\n\nRelevant history from the founder's Second Brain (cite when useful):\n- <title>: <summary>`.
- Append `secondBrainBlock` to the existing `system` string (mirrors `relevantBlock`/`memoryBlock`).
- Best-effort: any embed/load failure yields an empty block — chat never breaks or blocks on it.

### 2.2 Behavior
- With the feature off, `secondBrainBlock` is `''` — the chat prompt is unchanged.
- With it on, byte sees the most relevant ledger entries for the question and can reference them
  naturally, grounded in what actually happened.

---

## 3 · Testing

- `lib/overview/timeline.test.ts` — `filterEvents` (type mapping, newest-first) and `relativeTime`
  (buckets: seconds/minutes/hours/days/absolute) with a fixed `now`.
- P2.1 is exercised via the existing chat route; the retrieval block is guarded and best-effort.
  The embedding call is not unit-tested live (no key); the block-building is simple string join.

---

## 4 · Rollout / verification

- Timeline: `NEXT_PUBLIC_SECOND_BRAIN_V2=1`, open the panel, filter, click a row.
- Chat recall (owner, once `SECOND_BRAIN_RECALL=1` + `VOYAGE_API_KEY`): ask byte about a past
  decision and confirm it references the right prior work.

---

*Spec #3 — final phase of the Second Brain rebuild (P3 + P2.1).*
