# Second Brain — full activation design

**Date:** 2026-07-14
**Status:** design agreed — **implementation owned by the team** (not yet built)
**Companion visual:** memory-architecture artifact, "06 — Planned · Second Brain" section.
**Context:** follow-up from the Context & Memory Architecture trace (Notion: "Context & Memory Architecture" under CODEPET PRD — 1.2).

## Goal

Turn the episodic-memory layer on **end-to-end**: byte recalls relevant history in chat, **and** the founder can semantically search their own company memory. Full activation, not a partial flip.

## Current state (all built, gated OFF)

| Piece             | Where                                                                            | Note                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `events` ledger   | `companies/{uid}/events` (`schema.ts:165–175`)                                   | `LedgerEvent { ts, type, actor, deptK?, refType?, refId?, title, summary, vec? }` — embedding stored inline as `vec`. |
| Live write        | `appendEvent` (`companyData.ts:186`)                                             | Fires on stage advance, deliverable approval, decision made.                                                          |
| Backfill          | `app/api/second-brain/backfill/route.ts`                                         | Projects library / decisions / done-tasks into events; wired into `OverviewView` (`runSecondBrainBackfill`).          |
| Embed             | `app/api/second-brain/embed/route.ts` + `lib/ai/embed.ts`                        | Voyage `voyage-3`; lazily fills missing `vec`.                                                                        |
| Recall (chat)     | `lib/ai/secondBrainRecall.ts` → `chat/route.ts:318`                              | Embeds last message, cosine `topK(6)`, injects a prompt block. Uses **Admin SDK** (`adminDb()`).                      |
| Recall (endpoint) | `app/api/second-brain/recall/route.ts` + `askSecondBrain` (`recallClient.ts:30`) | **Coded but wired to nothing** — no component imports `askSecondBrain`.                                               |
| Gate              | `isEmbedEnabled()` (`embed.ts:8`)                                                | `VOYAGE_API_KEY` **and** `SECOND_BRAIN_RECALL === '1'`. Off ⇒ `recallBlock` returns `''`.                             |
| Retrieval         | `lib/overview/recall.ts`                                                         | `cosine()` + `topK()` — brute-force over all events.                                                                  |

## Locked decisions

1. **Search home = inside the nebula view.** The "Ask your memory" surface lives in the existing Second-Brain nebula (`OverviewView` / `SecondBrainPanel`), not a separate page.
2. **Embedding strategy = embed-on-write.** New events are embedded when `appendEvent` fires, so recall is always fresh (vs. embed-on-recall or a periodic sweep).

## Plan

### Part A — Recall grounding in chat (backend)

1. **Enable the gate** — set `VOYAGE_API_KEY` + `SECOND_BRAIN_RECALL=1` in **prod and preview** Vercel scopes. `recallBlock` then injects the top-6 relevant events into byte's chat prompt.
2. **Embed-on-write** — extend the `appendEvent` path so a newly written event is embedded (enqueue/await a Voyage embed and persist `vec`). Keep it fail-open: a failed embed leaves `vec` unset and recall simply skips that event until re-embedded.
3. **Backfill once on activation** — run `runSecondBrainBackfill` so existing library / decisions / completed tasks become searchable immediately, then the `/embed` fill covers their vectors.

### Part B — "Ask your memory" UI (user-facing, in the nebula)

1. **Query box** in the Second-Brain nebula view → the already-coded `askSecondBrain(query)` → `/api/second-brain/recall`.
2. **Deep-linked results** in `SecondBrainPanel` — each `RecallHit` carries `refType`/`refId`; render as a jump-to that opens the source (library item · decision · task), never a dead end.
3. **Honest states** — visibly distinguish: recall **off** (gate disabled) vs. **no events yet** vs. **no match**. Don't show an empty box that reads as "broken."

## Cross-cutting decisions the implementer must resolve

1. **Access-path inconsistency (blocking).** `recallBlock` reads events via the **Admin SDK** (`adminDb()`), while `/embed`, `/recall`, `/backfill` use Firestore **REST + the user's ID token**. Pick one path. Admin SDK needs a server service account configured; REST needs the caller's token. Mixing risks one path working in prod and the other failing silently. **Verify the Admin SDK path is actually provisioned before enabling recall in chat.**
2. **Cost & the credits model.** Per-message (recall query) + per-event (embed-on-write) embeddings are cheap on `voyage-3`, but they're a new external cost stream. Decide whether embeds count against the daily usage guard / credits, or ride outside it. (Pricing model: credits, chat priced below raw cost — see the pricing spec.)
3. **Scale ceiling.** Recall loads **all** events and does brute-force cosine per query — fine at one-founder scale (hundreds of events). Note the point where it needs a real index (thousands) so it's a known future item, not a surprise.

## Verification (when implemented)

- **Chat recall:** with the gate on, ask byte about a past decision/approval → the reply should reflect the actual event (and the injected block should be present server-side). With the gate off, chat behaves exactly as today.
- **Search UI:** lock a decision + approve a deliverable, then search a related phrase in the nebula → both surface as hits and each click lands on the right source.
- **Fail-open:** with Voyage unreachable, chat and the nebula still render; recall just returns empty.

## Out of scope / non-goals

- No change to the structured/semantic memory (`brief`, `decisions`) — that path is unaffected.
- No migration off inline `vec` storage or off brute-force cosine in this pass (noted as a future scale item).
- Grounding-broadening for the lighter routes is a **separate, already-shipped** change (PR #143).
