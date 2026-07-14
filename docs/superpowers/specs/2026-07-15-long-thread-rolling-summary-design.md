# Long-thread memory — rolling per-thread summary

**Date:** 2026-07-15
**Status:** implemented (PR → develop)
**Context:** third follow-up from the Context & Memory Architecture trace.

## Problem

Byte's chat only sends the most recent `MAX_CHAT_TURNS = 20` turns to the model
(`chatMessages.ts`); older turns are dropped. The design comment says that's "safe"
because grounding comes from the project model — but that only holds for things that became
a durable `decision`. Anything a founder explains in a long back-and-forth (constraints,
preferences, nuance) silently falls off the cliff at turn 21, so within one conversation
byte can forget what was said earlier.

## Approach (chosen)

**Rolling per-thread summary.** When turns scroll past the window, condense them into a
persisted "conversation so far" summary stored on the thread, injected alongside the project
model on later chat calls. Client-orchestrated so the streaming chat response takes no extra
latency; the summarizer runs in the background after a reply.

## Design

### Pure core — `lib/ai/threadSummary.ts` (unit-tested, no React/SDK/network)
- `planThreadSummary(history, summarizedThrough, window, batch)` → `{ turns, through }`.
  Summarizes dropped turns beyond the high-water mark, **only once `SUMMARY_BATCH = 8`**
  have accumulated (batches summarizer calls; short threads never trigger one).
- `formatThreadSummaryBlock(summary)` → the system-prompt block (empty when no summary).
- `SUMMARY_SYSTEM` + `buildSummaryPrompt(prior, turns)` → the fold prompt.

### Endpoint — `app/api/summarize-thread/route.ts`
Auth-gated, behind the daily cost guard. Takes `{ priorSummary, turns }`, folds them on
`LIGHT_MODEL` (512 tokens), returns `{ summary }`. Input bounded (≤60 turns, ≤2000 chars each).

### Chat route — `app/api/chat/route.ts`
Accepts `body.threadSummary` and injects `formatThreadSummaryBlock(...)` into the system
prompt, right after the Second-Brain block and before the dept summary.

### Client — `lib/ai/chat.ts` + `lib/store.tsx`
- `streamByteChat` gains a `threadSummary` arg → sent in the chat body.
- `summarizeThread(priorSummary, turns)` → the `/api/summarize-thread` client call (best-effort).
- `store.maybeSummarizeThread(threadId, turns)`: after a successful reply, runs
  `planThreadSummary`; if a batch is due, calls the endpoint and persists the new
  `summary` + `summarizedThrough` on the thread (`persistThread`). Fire-and-forget — no
  added latency to the chat response.

### Persistence — `lib/firebase/schema.ts`
`ThreadMeta` gains `summary?: string` and `summarizedThrough?: number`. Both round-trip
for free: `persistThread` writes the whole doc and the loader spreads it (`{ ...data, id }`).

## Trade-offs / notes

- **Batching gap:** up to `SUMMARY_BATCH - 1` (7) just-dropped turns are momentarily in
  neither the verbatim window nor the summary, until the next fold. Bounded and brief;
  lower `SUMMARY_BATCH` to shrink the gap at higher cost.
- **Background summarize counts against the daily cost guard** (consistency + cost
  protection). Infrequent (once per 8 dropped turns) and cheap (`LIGHT_MODEL`, 512 tokens).
  If rate-limited, the fold simply retries next batch (fail-open).
- **No latency added to chat** — summarization is a post-reply background call.
- **Severity caveat:** Codepet chat is task-oriented; threads may rarely exceed 20 turns.
  If usage data shows long threads are rare, this can stay minimal. Cheap where it never fires.

## Verification

- Unit: 10 tests in `lib/ai/threadSummary.test.ts`; full suite **721 pass**, typecheck + prettier clean.
- Manual (preview): hold a 28+ turn thread; state a preference early (e.g. "keep replies short"),
  then keep chatting past the window → byte should still honor it. Reload mid-thread → the
  summary persists (thread doc carries `summary` / `summarizedThrough`). With the summarizer
  unreachable, chat still works; the summary just doesn't advance.
