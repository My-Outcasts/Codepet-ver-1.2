# Persist-failure resilience — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A failed Firestore write of the user's durable work (a generated draft, an approved deliverable, the founder's brief) never vanishes silently — it auto-retries a transient blip, and if it truly can't save, tells the user honestly.

**Architecture:** One shared `persistWithRetry(write, opts)` seam (bounded exponential-backoff retry + honest toast on exhaustion, never rejects), applied to exactly three call sites in the store. No offline queue, no manual retry button, no persistent unsaved badge.

**Tech Stack:** Next.js 16 / React 19, TypeScript, node-env Vitest.

## Global Constraints

- **Only the user-work trio** gets the seam: `persistTaskDraft` (→ `persistDepartmentTasks`), `persistApproval`, `persistBrief`. Low-stakes writes (roadmap stage, companion, introSeen, projectAnalysis, env, message) stay as `console.error` best-effort — do NOT wrap them.
- **`persistWithRetry` never rejects** — it owns its errors; call sites stay fire-and-forget (no `.catch`).
- **Optimistic in-memory updates unchanged** — only each write's failure handling changes.
- **No `useCallback` dependency-array changes** — `toast` is a stable callback, `persistWithRetry` is a module import; keep every callback's deps exactly as they are (React-Compiler ESLint at ERROR).
- `npm run format:check` before pushing.

---

## Task 1: The `persistWithRetry` seam (pure, tested)

**Files:**

- Create: `lib/firebase/persistWithRetry.ts`
- Test: `lib/firebase/persistWithRetry.test.ts`

**Interfaces:**

- Produces: `persistWithRetry(write: () => Promise<void>, opts: { toast: (msg: string) => void; failMessage: string; label: string; retries?: number; baseDelayMs?: number }): Promise<void>` — consumed by Task 2.

- [ ] **Step 1: Write the failing test** — `lib/firebase/persistWithRetry.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { persistWithRetry } from './persistWithRetry';

const opts = (toast: (m: string) => void, extra = {}) => ({
  toast,
  failMessage: 'could not save',
  label: 'test',
  baseDelayMs: 0, // no real wait in tests
  ...extra,
});

describe('persistWithRetry', () => {
  it('succeeds on the first try → write once, no toast', async () => {
    const toast = vi.fn();
    const write = vi.fn().mockResolvedValue(undefined);
    await persistWithRetry(write, opts(toast));
    expect(write).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
  });

  it('retries a transient failure then succeeds → no toast', async () => {
    const toast = vi.fn();
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error('blip'))
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValue(undefined);
    await persistWithRetry(write, opts(toast));
    expect(write).toHaveBeenCalledTimes(3); // 1 + 2 retries
    expect(toast).not.toHaveBeenCalled();
  });

  it('exhausts retries → write retries+1 times, toast once with failMessage', async () => {
    const toast = vi.fn();
    const write = vi.fn().mockRejectedValue(new Error('down'));
    await persistWithRetry(write, opts(toast)); // default retries: 2
    expect(write).toHaveBeenCalledTimes(3);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('could not save');
  });

  it('honors a custom retries count', async () => {
    const toast = vi.fn();
    const write = vi.fn().mockRejectedValue(new Error('down'));
    await persistWithRetry(write, opts(toast, { retries: 0 }));
    expect(write).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('never rejects, even when write always throws', async () => {
    const write = vi.fn().mockRejectedValue(new Error('down'));
    await expect(persistWithRetry(write, opts(vi.fn()))).resolves.toBeUndefined();
  });
});
```

Run: `npx vitest run lib/firebase/persistWithRetry.test.ts` → FAIL (module not found).

- [ ] **Step 2: Implement** — `lib/firebase/persistWithRetry.ts`:

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

Run: `npx vitest run lib/firebase/persistWithRetry.test.ts` → PASS. Then `npx tsc --noEmit` (only the pre-existing `firestore.rules.test.ts` errors), `npx eslint lib/firebase/persistWithRetry.ts lib/firebase/persistWithRetry.test.ts`.

- [ ] **Step 3: Commit** — `git commit -m "feat(persist): persistWithRetry seam — bounded retry + honest failure toast"`

---

## Task 2: Wrap the three user-work writes

**Files:**

- Modify: `lib/store.tsx`

**Interfaces:**

- Consumes: `persistWithRetry` (Task 1).

- [ ] **Step 1: Import** — add to the store's imports:

```ts
import { persistWithRetry } from '@/lib/firebase/persistWithRetry';
```

(Match the existing import style — the other `@/lib/firebase/*` persist functions are imported near the top of `lib/store.tsx`.)

- [ ] **Step 2: Draft write** (`persistTaskDraft`) — replace:

```ts
persistDepartmentTasks(companyId, d).catch((err) =>
  console.error('[store] persistTaskDraft failed', err),
);
```

with:

```ts
persistWithRetry(() => persistDepartmentTasks(companyId, d), {
  toast,
  label: 'persistTaskDraft',
  failMessage: 'Couldn’t save this draft — it may be lost if you reload.',
});
```

- [ ] **Step 3: Approval write** (`approveTask`) — replace:

```ts
persistApproval(companyId, d, item, Date.now()).catch((err) => {
  console.error('[store] persistApproval failed', err);
  toast('Saved locally — sync failed');
});
```

with (capture the timestamp once so retries reuse it):

```ts
const approvedAt = Date.now();
persistWithRetry(() => persistApproval(companyId, d, item, approvedAt), {
  toast,
  label: 'persistApproval',
  failMessage: 'Saved here, but syncing failed — it may not persist.',
});
```

- [ ] **Step 4: Brief write** (`advanceStage`) — replace:

```ts
persistBrief(companyId, updated).catch((err) => console.error('[store] persistBrief failed', err));
```

with:

```ts
persistWithRetry(() => persistBrief(companyId, updated), {
  toast,
  label: 'persistBrief',
  failMessage: 'Couldn’t save your project details — they may not persist.',
});
```

- [ ] **Step 5: Verify** — from the worktree root:
  - `npx tsc --noEmit` (only the 2 pre-existing `firestore.rules.test.ts` errors — no new).
  - `npx eslint lib/store.tsx` (0 errors, 0 new warnings — confirm NO `useCallback` dep-array changed: `persistTaskDraft` stays `[companyId, bump]`, `approveTask`/`advanceStage` unchanged).
  - `npx vitest run` (all pass), `npm run format:check` (clean).

- [ ] **Step 6: Commit** — `git commit -m "fix(store): draft/approval/brief writes retry + surface failure instead of vanishing"`

---

## Self-Review Notes (author checklist — done)

- **Spec coverage:** the seam → Task 1; the three user-work call-site wraps (draft/approval/brief) → Task 2; low-stakes writes deliberately untouched (Global Constraints).
- **Type consistency:** `persistWithRetry`'s signature in Task 1 matches every Task 2 call (thunk `() => persistX(...)` returns `Promise<void>`; `toast: (msg: string) => void` matches the store's `toast`).
- **No placeholders:** full code for the helper, its tests, and every call-site replacement (old → new).
- **Lint traps:** no `useCallback` dep-array changes (toast stable, persistWithRetry a module import); no set-state-in-effect; `persistWithRetry` never rejects so call sites need no `.catch`.
- **Behavior preserved:** optimistic in-memory updates, `approveTask`'s item return + fact extraction, `persistTaskDraft`'s early-return guard, `advanceStage`'s growthSignal/rollback all untouched.
