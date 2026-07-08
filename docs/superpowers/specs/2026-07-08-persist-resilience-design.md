# Persist-failure resilience — no silent loss of the user's work (audit P1-B)

**Date:** 2026-07-08
**Scope:** The store's fire-and-forget Firestore writes for the user's / byte's durable
work. A failed write is currently swallowed to `console.error`, so a generated draft (or an
approved deliverable, or the founder's brief) can vanish on reload with no signal. From the
whole-app gap audit's P1 tier (data-loss half). **P1-B, persist-failure resilience only** —
onboarding-progress resume is a separate deferred piece.
**Status:** Design approved (brainstorm), ready for implementation plan.

## Problem

Three writes of the user's durable work are best-effort with no user-visible failure and no
retry (confirmed on `main`, tip `21f1d01`):

1. **`persistTaskDraft` → `persistDepartmentTasks` (`lib/store.tsx:1423`)** — SILENT
   (`console.error` only). byte generates a draft, `t.drafted = true`, the in-memory task
   flips to "Awaiting approval"; if the write fails, on reload the draft **and** its state
   are gone with **zero** signal. This is the sharp bug.
2. **`persistApproval` (`lib/store.tsx:1358`)** — toasts once ("Saved locally — sync
   failed") but never retries; a transient blip permanently loses the approved deliverable.
3. **`persistBrief` (`lib/store.tsx:1119`)** — SILENT; a lost brief means re-onboarding.

Root cause: each call is `persistX(...).catch((err) => console.error(...))` — a transient
network blip is indistinguishable from success, and the user is never told.

## Approach (chosen from brainstorm)

One shared seam, applied to exactly the three user-work writes. No offline queue, no manual
"Retry" button (toasts here are string-only), no persistent "unsaved" badge — YAGNI.

### The helper — `lib/firebase/persistWithRetry.ts`

```ts
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Best-effort persistence that survives a transient blip and, if it ultimately can't save,
// tells the user honestly instead of swallowing the loss. Retries `write` with exponential
// backoff; on final failure logs + shows `failMessage`. Never rejects — callers fire-and-forget.
export async function persistWithRetry(
  write: () => Promise<void>,
  opts: {
    toast: (msg: string) => void;
    failMessage: string;
    label: string; // for the console log only
    retries?: number; // default 2 (→ 3 attempts total)
    baseDelayMs?: number; // default 400 (tests pass 0)
  },
): Promise<void> {
  const retries = opts.retries ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 400;
  for (let attempt = 0; ; attempt++) {
    try {
      await write();
      return;
    } catch (err) {
      if (attempt >= retries) {
        console.error(`[persist] ${opts.label} failed after ${attempt + 1} attempts`, err);
        opts.toast(opts.failMessage);
        return;
      }
      await sleep(baseDelayMs * 2 ** attempt); // 400ms, 800ms
    }
  }
}
```

- **Auto-retry rides out blips silently:** a write that fails once or twice then succeeds
  toasts nothing.
- **Honest on exhaustion:** after all attempts fail, one `console.error` + the caller's
  `failMessage`.
- **Never rejects:** it owns its errors, so call sites stay fire-and-forget (no `.catch`).
- **Unit-testable:** inject `write` (count calls) and pass `baseDelayMs: 0` (no real wait).

### Call-site changes — `lib/store.tsx` (the user-work trio)

Each `persistX(...).catch(console.error)` becomes a `persistWithRetry` call:

- **Draft** (`persistTaskDraft`): `persistWithRetry(() => persistDepartmentTasks(companyId, d), { toast, label: 'persistTaskDraft', failMessage: "Couldn't save this draft — it may be lost if you reload." })`
- **Approval** (`approveTask`): capture `const at = Date.now();` once, then `persistWithRetry(() => persistApproval(companyId, d, item, at), { toast, label: 'persistApproval', failMessage: 'Saved here, but syncing failed — it may not persist.' })` (replaces the existing single-shot toast).
- **Brief** (`advanceStage`): `persistWithRetry(() => persistBrief(companyId, updated), { toast, label: 'persistBrief', failMessage: "Couldn't save your project details — they may not persist." })`

`toast` is already a stable `useCallback`; `persistWithRetry` is a module import — so no
`useCallback` dependency arrays change (`persistTaskDraft`'s stays `[companyId, bump]`, etc.).

## Left as-is (out of scope)

The low-stakes / re-derivable writes keep their `console.error` best-effort catch —
`persistRoadmapStage`, `persistCompanion`, `persistIntroSeen`, `persistProjectAnalysis`,
`persistEnv`, `persistEnvUsage`, `persistMessage`. Wrapping them would be scope creep; a
silently-retried roadmap-stage or companion write is fine, and a failure toast there would be
noise. (`persistScaffold` already has its own handling via `scaffoldCompany`.)

## Files

- **Create** `lib/firebase/persistWithRetry.ts` (+ `persistWithRetry.test.ts`).
- **Modify** `lib/store.tsx` — wrap the three call sites (draft, approval, brief).

## Coexistence (unchanged, must keep working)

The optimistic in-memory update at each site is untouched (the user still sees the draft /
approval / stage immediately); only the write's failure handling changes. `advanceStage`'s
piece-3 `growthSignal` + rollback, `approveTask`'s library-item return + byte's durable-fact
extraction, and `persistTaskDraft`'s guard (`t.done`/`t.run === 'route'` early-return) are
all preserved. No change to the persist functions in `lib/firebase/companyData.ts` themselves.

## Edge cases

- **Transient blip (offline 1-2s):** first attempt(s) fail, a retry succeeds → no toast,
  work saved.
- **Persistent failure (permissions / long outage):** all attempts fail → one honest toast;
  the in-memory work stands for the session but the user knows it may not survive reload.
- **`companyId` null:** the call sites already guard on `companyId` before persisting —
  unchanged (no write attempted, no toast).
- **Rapid re-saves (two draft saves in a row):** each is an independent `persistWithRetry`;
  the later successful write wins. No coordination needed.

## Testing

- **Unit (node-env Vitest):** `persistWithRetry` with `baseDelayMs: 0` —
  - `write` succeeds first try → called once, `toast` not called.
  - `write` fails twice then succeeds → called 3×, `toast` not called.
  - `write` always fails → called `retries + 1` times, `toast` called once with `failMessage`.
  - never rejects (the returned promise resolves in every case).
- **Manual (Vercel PR preview):** with writes healthy, draft/approve/advance persist and
  survive reload as before (no regression); the failure toasts are copy-only and low-risk to
  eyeball.

## Non-goals (YAGNI)

- No offline write-queue / durable outbox.
- No manual "Retry" button or actionable toast (the toast API is string-only).
- No persistent per-task "unsaved" indicator.
- No wrapping of the low-stakes writes.
- No onboarding-progress resume (separate deferred piece).

## Dependencies & sequencing

Builds off `origin/main` (tip `21f1d01`). Standalone PR. Isolated worktree (concurrent
sessions move `main`); verify on the Vercel preview; run `npm run format:check` before
pushing. This completes the audit's P1 tier alongside P1-A (#107). Next audit tranche: **P2**
(dead-ends).
