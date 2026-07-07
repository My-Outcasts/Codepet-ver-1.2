# Graceful degradation when byte is down (P0 failure-path hardening)

**Date:** 2026-07-07
**Scope:** The app's AI failure paths only — never a dead-end, never a crash, never a
dishonest message when the model is unreachable / rate-limited / declines. Success paths
untouched. From the whole-app gap audit's P0 tier.
**Status:** Design approved (brainstorm), ready for implementation plan.

## Problem

The app is currently in an AI-outage state (Anthropic credits exhausted). The audit found
the **failure paths** are the weak point — four concrete P0 gaps, all live right now:

1. **A first-run generation _failure_ crashes the whole app.** For the 8 rich deliverable
   types (post/email/legal/dms/calendar/checklist/screens/sheet), the modal renders
   `<ViewerOnce item={item}>` on `genStatus === 'error'` even when the payload was never
   generated (a scaffolded task carries only `kind`). The viewer dereferences an undefined
   payload (`post.variants`, `email.body.map`, …) → uncaught `TypeError`. There is **no
   `app/error.tsx`**, so it's a full-page "Application error." The error note even says
   "showing the saved draft" when no draft exists (`ArtifactModal.tsx:496-501`).
2. **Chat mislabels an outage as a connection problem.** Chat streams a `200` before the
   upstream call fails; the stream `catch` calls `controller.error(err)` with no
   classification (`app/api/chat/route.ts:435-438`). The client only throws `ChatError` on
   `!res.ok` (`lib/ai/chat.ts:56`), which never fires here, so the store buckets it as
   `'network'` → "check your connection" during a byte/billing outage
   (`lib/store.tsx:1783-1784`).
3. **The Overview banner is often dishonest about the cause.** `scaffoldFailed` is a single
   boolean, so a refusal / parse error / auth failure all render as "byte couldn't reach
   the model" (`lib/examplePlan.ts:29`).
4. **Retry can hammer the failing endpoint.** `regenerateCompany` has no in-flight guard
   and its buttons aren't disabled while running (`OverviewView.tsx:811-825`,
   `CompanyView.tsx:26`), so during the outage a user mashes paid, failing calls.

## Approach

Four surgical fixes, one cohesive "byte-down graceful degradation" effort. Sequenced with
**#1 first** (the crash — most urgent, most independent). Failure-path only.

### 1. Stop the crash + honest deliverable failure state

Three layers (defense in depth):

- **`app/error.tsx`** — a Next.js route-level error boundary so nothing can take the whole
  app down; worst case is a contained "Something went wrong · Try again / Reload."
- **`components/ErrorBoundary.tsx`** — a small reusable class error boundary (React error
  boundaries must be class components; no new dependency). It renders a `fallback` on any
  child throw.
- **`ArtifactModal.tsx`** — the real fix:
  - A pure guard `hasDeliverablePayload(t, type): boolean` (in `lib/ai/applyResult.ts`,
    unit-tested) — true when the task actually carries its type's payload
    (`post`/`email`/`legal`/`dms`/`calendar`/`checklist`/`screens`/`sheet`/`site` present,
    or `out` for text types). Empty/scaffold-only tasks → false.
  - In the rich-type render branch, when `genStatus === 'error'` **and**
    `!hasDeliverablePayload` → render a **failure state** instead of `<ViewerOnce>`: the
    cause-aware `liveErrorMsg` the modal already computes (rate-limited / byte-unavailable
    / declined) with a headline **"byte couldn't generate this right now"** + a **Retry**
    button wired to the existing `startRun`. No "showing the saved draft" text when no
    draft exists (only show that note when `hasDeliverablePayload` is true).
  - Wrap `<ViewerOnce>` in `<ErrorBoundary fallback={<failure state>}>` as a backstop, so
    even an unforeseen viewer deref degrades to the same failure state, never a crash.
  - Text types (`doc`/`prep`/`build`) with an empty `out` on error get the same failure
    state instead of a blank body.

### 2. Chat: tell the truth during an outage

Reuse the existing trailing-mark protocol (`ACTION_MARK = 0x1e`). Add an **error mark**:

- **`app/api/chat/route.ts`** — replace the stream `catch`'s `controller.error(err)` with:
  classify the error via the shared seam into a code (`ai_unavailable` / `rate_limited` /
  `refused` / `not_configured`), `controller.enqueue(ERROR_MARK + JSON.stringify({ code
}))`, then `controller.close()` (do NOT `controller.error`, which the client can't read).
  `ERROR_MARK` = a new control char (`0x1c`), added alongside `ACTION_MARK`/`BUILD_MARK`.
- **`lib/ai/client.ts`** — export a small `errorCodeOf(err): string` that maps a caught
  error to the same code `aiErrorResponse` would use (reusing `classifyFailureKind`/the
  `GenerationError` kind), so the route classifies consistently with every other surface.
- **`lib/ai/chat.ts`** — recognize `ERROR_MARK`; when seen, `throw new ChatError(code)`
  (parsed from the mark JSON). Existing text/action parsing unchanged.
- The store's existing `errCode` bucketing (`lib/store.tsx:1774-1785`) then shows the right
  copy — `ai_unavailable` → "byte is temporarily unavailable — Retry" instead of "check
  your connection." No store change needed beyond confirming the codes line up.

### 3. Overview banner: honest about the cause

- **`lib/ai/scaffold.ts`** — `scaffoldCompany` returns `{ changed: number; failure: string
| null }` instead of a bare number: on a failed attempt, read `data.error` (the route's
  code) and return it as `failure`; `null` on success or no-attempt.
- **`lib/store.tsx`** — replace the `scaffoldFailed: boolean` state with `scaffoldFailure:
string | null`; the three `scaffoldCompany` callers (`finishOnboarding`,
  `regenerateCompany`, `advanceStage`) destructure `{ changed, failure }`, keep their
  existing `if (changed)` logic (incl. piece-3's `growthSignal`), and set `scaffoldFailure`
  from `failure`.
- **`lib/examplePlan.ts`** (+ `examplePlan.test.ts`) — `examplePlanBanner` takes
  `{ planTailored, scaffoldFailure }` and picks cause-aware copy: `rate_limited` → "over
  your daily limit — resets tomorrow"; `refused` → "byte couldn't tailor this one — try
  again"; `not_configured`/`ai_unavailable`/anything-else → "byte couldn't reach the
  model." Unit-tested truth table.

### 4. Scaffold retry: no hammering

- **`lib/store.tsx`** — add a `regenerating: boolean` state + a `regenInFlightRef`;
  `regenerateCompany` early-returns if in-flight, sets `regenerating` true around the call
  and false in a `finally`. Expose `regenerating` on `useApp()`.
- **`OverviewView.tsx`** + **`CompanyView.tsx`** — `disabled={regenerating}` on the
  "Generate my plan" / "Retry" / "Re-plan" buttons, with a "…" busy label while running.
- No hard daily cap on scaffold (that would block legitimate onboarding re-plans) — the
  in-flight guard + disabled button is the right-sized fix.

## Files

- **Create** `app/error.tsx`, `components/ErrorBoundary.tsx`.
- **Modify** `lib/ai/applyResult.ts` (+ its test) — `hasDeliverablePayload`.
- **Modify** `components/artifact/ArtifactModal.tsx` — payload guard, failure state, boundary, honest copy.
- **Modify** `app/api/chat/route.ts`, `lib/ai/chat.ts`, `lib/ai/client.ts` — the chat error mark + `errorCodeOf`.
- **Modify** `lib/ai/scaffold.ts`, `lib/store.tsx`, `lib/examplePlan.ts` (+ its test) — scaffold failure cause + retry guard.
- **Modify** `components/views/OverviewView.tsx`, `components/views/CompanyView.tsx` — disable retry while running.

## Coexistence (unchanged, must keep working)

Every success path: live generation + "Written live by byte", the approve/persist loop,
chat streaming + tool marks + memory, the scaffold apply, the example-plan banner's
tailored/not-run states, piece-3's `growthSignal` on advance. The shared error seam in
`client.ts` is extended (new `errorCodeOf`), not rewritten. No new dependency.

## Edge cases

- **Failed first run then Retry succeeds** → failure state → `startRun` → normal viewer.
- **Task with a real seed draft** (some seed types do carry a payload) + error → keep
  showing the draft with the existing "showing the saved draft" note (guarded by
  `hasDeliverablePayload`).
- **Chat error mark mid-stream** → partial text already streamed stays; the `ChatError`
  turns the bubble into the failed state with Retry (existing behavior for `!res.ok`).
- **`errorCodeOf` on an unknown error** → falls back to a generic code → generic-but-honest
  copy ("byte is temporarily unavailable"), never "check your connection."
- **Scaffold Retry double-click** → the in-flight guard drops the second call; the button
  is disabled anyway.
- **Scaffold succeeds** → `failure: null` → banner clears (unchanged tailored path).
- **`app/error.tsx` reset** → offers "Try again" (Next's `reset()`) and a reload.

## Testing

- **Unit (node-env Vitest):**
  - `hasDeliverablePayload` — true for each type with its payload present, false for a
    scaffold-only task (only `kind`), false for empty `out` text types.
  - `examplePlanBanner` — the cause-aware truth table (tailored → null; each failure code →
    its copy; not-run → "Generate my plan").
  - `errorCodeOf` — maps GenerationError kinds / an Anthropic credit/billing error / a 429
    / a refusal to the expected codes (extend `lib/ai/client.test.ts`).
  - `lib/ai/chat.ts` error-mark parse (if the stream parser is unit-testable) — an
    `ERROR_MARK` payload throws `ChatError` with the code.
- **Manual (Vercel PR preview — the model is currently unreachable, so failures are easy to
  reproduce):** open a scaffolded rich task with byte down → **no crash**, a "byte couldn't
  generate this right now · {cause} · Retry" state; send a chat message → "byte is
  temporarily unavailable — Retry" (not "check your connection"); the Overview banner
  states the real cause; the "Generate my plan"/"Retry"/"Re-plan" buttons disable while
  running and can't be mashed.

## Non-goals (YAGNI)

- No change to success-path generation, the deliverable content, or the scaffold logic
  itself.
- No client-side request timeout / "Stop" button (audit Minor — separate).
- No daily cap on scaffold/build-plan; no `/api/build-plan` seam refactor; no
  `/api/personalize` dead-code removal (audit P1–P3 — separate follow-ups).
- No onboarding-skip / partial-scaffold honesty fix (audit P1 — the next tranche).

## Dependencies & sequencing

Builds off `origin/main` (tip `468dfb9`). One PR; tasks sequenced with **#1 first** so the
crash fix is reviewable/shippable on its own if desired. Verify on the Vercel preview
(failures reproduce naturally while the model is down); run `npm run format:check` before
pushing. Follow-ups (from the audit): P1 honesty (skip/partial scaffold, success-toast),
P1 data-loss (silent draft/approve persistence), P2 dead-ends (all-dormant, "next move"),
P3 polish.
