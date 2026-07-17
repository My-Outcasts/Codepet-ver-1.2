# Prompt caching — make it actually hit (chat + run-task)

**Status:** Design approved (2026-07-17), ready for implementation plan.
**Scope:** Core — the two high-frequency, high-cost routes (`chat`, `run-task`/`task-help`).

## Problem

Anthropic prompt caching is already wired into the client seam (`lib/ai/client.ts`):
`cachedSystem()` tags the system prompt and `cacheTools()` tags the tool set with
`cache_control: ephemeral`, on both the streaming and non-streaming paths, and usage
tracking already captures `cache_read`/`cache_write` tokens. But it is **structurally
ineffective on the routes that matter**, because the single cache breakpoint sits at the
_end_ of one combined system block:

```ts
function cachedSystem(system: string): Anthropic.TextBlockParam[] {
  return [{ type: 'text', text: system, cache_control: CACHE }];
}
```

The cached unit is therefore the _entire_ system string, so a cache **hit** requires the
whole string to be byte-identical to a prior request within the 5-minute TTL.

Audited consequence (per-route evidence in the 2026-07-17 caching-effectiveness audit):

- **`chat`** (largest, most frequent route) is **write-only → net cost.** The ~1,115-token
  stable `BYTE_SYSTEM` is placed first, but nine volatile blocks (company context,
  prior-work ranked to the last message, second-brain recall, thread summary, dept
  snapshot, runnable tasks, setup, memory, dept expertise, persona) are appended after it.
  Prior-work and recall change on _every send_, so the full system string changes every
  turn → the cache is rewritten each turn, paying the **+25% write surcharge with ~0%
  reads.** This directly undermines the pricing assumption (chat priced below raw cost) that
  made caching a launch dependency.
- **`run-task` / `task-help`** are the only real hits today (system is stable-only; all
  per-task content lives in the user prompt). But `personaOverride` is appended last and
  varies by department, so consecutive runs in _different_ departments miss.
- Eight other routes have stable-but-sub-1,024-token systems (silently not cached — harmless
  no-ops), and `build-plan`/`build-brainstorm` bypass the client entirely. **All out of
  scope here.**

## Goal

Convert `chat` from write-only to a real per-turn cache hit, and de-fragment
`run-task`/`task-help` so cross-department runs hit — with one small, backward-compatible
mechanism change in the client seam and no change to the public API contract.

## Design

### 1. Client seam: a stable/volatile split (`lib/ai/client.ts`)

Introduce a system-input shape that lets a route mark where the cacheable prefix ends:

```ts
export type SystemInput = string | { stable: string; volatile?: string };
```

`cachedSystem` handles both:

- `string` → `[{ type: 'text', text, cache_control: CACHE }]` — **unchanged** behavior. Every
  route we are _not_ touching (scaffold, roadmap, summarize-thread, …) keeps passing a plain
  string and is completely unaffected — zero call-site churn.
- `{ stable, volatile }` → `[{ type: 'text', text: stable, cache_control: CACHE }, { type:
'text', text: volatile }]` when `volatile` is non-empty; the breakpoint lands **after the
  stable block only**, so the stable prefix is the cached unit and the volatile block is
  billed normally. When `volatile` is empty/absent, behaves as the string case (single
  cached block).

`generateText`, `generateJson`, and `streamMessage` change their `system` field type from
`string` to `SystemInput` and pass it straight to `cachedSystem`. No other logic in those
functions changes. `cacheTools()` is untouched.

**Why this shape:** overloading the existing `system` field keeps the change backward
compatible (every current route passes a string and is unaffected) and keeps cache-placement
policy centralized in the client — routes declare _what_ is stable, not _how_ caching works.

### 2. `chat` route (`app/api/chat/route.ts`)

Today the system is one concatenation, roughly:

```
BYTE_SYSTEM + context + relevantBlock + secondBrainBlock + threadSummaryBlock
  + deptSummary + runnableBlock + setupBlock + memoryBlock + deptExpertiseBlock + persona
```

Split it at the context boundary:

- **stable** = `BYTE_SYSTEM` + the company-context block
  (`"\n\nThe founder's company: " + composeProjectModel(...)`).
- **volatile** = everything from `relevantBlock` onward (prior-work, recall, thread summary,
  dept snapshot, runnable tasks, setup, memory, dept expertise, persona).

**Why context is in the _stable_ block, not just `BYTE_SYSTEM`:** `composeProjectModel` is
deterministic from `brief + decisions + shipped`, so the context string is byte-identical
across consecutive turns that don't change a decision or ship a deliverable — i.e. most
turns. It sits immediately before the first per-message block, making it the natural
breakpoint. When a decision/deliverable _does_ land mid-chat, the stable block changes once
and pays exactly one re-write, then hits again. Net effect: ~1,500–2,500 stable tokens/turn
served at ~90% off instead of the whole system being rewritten each turn.

`BYTE_SYSTEM` alone (~1,115 tokens) clears the 1,024-token minimum, so even a thin brief (tiny
context) still caches.

### 3. `run-task` / `task-help` routes

Currently: `system: composeRunSystem(context) + personaOverride(companionForDept(...).id)` —
one stable string, but persona fragments it per department.

Change to the split, moving persona to volatile:

```ts
system: { stable: composeRunSystem(context), volatile: personaOverride(...) }
```

The stable prefix (`BYTE_SYSTEM` + company context) is now identical across departments, so
consecutive runs in different departments hit. Same-department behavior is unchanged (still a
hit).

**Known caveat (not regressed, just not improved):** run-task's `BYTE_SYSTEM` is a _smaller_
constant (~215 tokens) than chat's. For a thin brief, `composeRunSystem(context)` can still
fall under the 1,024-token minimum and not cache — exactly as today. Rich briefs cache.

### 4. TTL

Keep the default **5-minute ephemeral** cache. It matches active-session cadence (the TTL
resets on each read) and is cheaper than the 1-hour tier. The 1-hour TTL (for cross-session
gaps) is a possible later optimization, not part of this work.

## Data flow

```
route builds { stable, volatile }
  → generateText / streamMessage (system: SystemInput)
    → cachedSystem(system)  → [ {stable, cache_control}, {volatile} ]
      → messages.create / messages.stream
        → usage.cache_read_input_tokens / cache_creation_input_tokens
          → logUsage()  ([ai] log line, already present)
          → onUsage()   (per-user daily token sink, already present)
```

No new persistence, no schema change, no client-facing contract change.

## Error handling

No new failure modes. `cachedSystem` is pure string→blocks and cannot throw on valid input.
An empty `volatile` degrades to the single-block (string) path. All existing
GenerationError/aiErrorResponse handling is unchanged.

## Testing

`cachedSystem` becomes the one piece of new pure logic and gets unit tests
(`lib/ai/client.test.ts`, extending it if present):

1. `string` input → exactly one block, `cache_control` present (backward-compat).
2. `{ stable, volatile }` → two blocks; **only** the stable (first) block carries
   `cache_control`; the volatile block does not; order is stable-then-volatile.
3. `{ stable }` with absent/empty `volatile` → one block (stable), cached — no empty trailing
   block.
4. Text integrity: `stable`/`volatile` text is passed through unmodified (no trimming/merging
   that would change the byte-identical prefix and break hits).

Regression: full existing suite must stay green; the `system`-type widening must not break any
route call site (all current string call sites remain valid).

**Post-deploy verification (manual, not automated here):** on the Vercel preview, send two
chat turns in one thread and confirm the second turn's `[ai] label=chat` log line shows
`cache_read > 0` (turn 1 writes, turn 2 reads). Confirm run-task shows `cache_read > 0` on a
second same-company deliverable, including across two different departments.

## Out of scope (filed for later)

- Lifting the eight sub-1,024-token no-op routes into real hits by moving their large stable
  content (department foundations, phase specs) from the user prompt into a cached stable
  block.
- Routing `build-plan` / `build-brainstorm` through the shared client so they cache at all.
- A persisted cache hit-rate metric / dashboard (beyond the existing `[ai]` log line).
- The 1-hour cache TTL tier for cross-session reuse.

## Files touched

- `lib/ai/client.ts` — `SystemInput` type; `cachedSystem` two-block path; `system` field type
  on `GenerateOptions` / `StreamOptions`.
- `lib/ai/client.test.ts` — `cachedSystem` unit tests (new or extended).
- `app/api/chat/route.ts` — pass `system: { stable, volatile }`.
- `app/api/run-task/route.ts`, `app/api/task-help/route.ts` — pass
  `system: { stable, volatile: persona }`.
