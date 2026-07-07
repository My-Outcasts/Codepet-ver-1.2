# Graceful degradation when byte is down — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the model is unreachable / rate-limited / declines, the app never crashes, never dead-ends, and never lies about why — across the deliverable modal, chat, the Overview banner, and the scaffold-retry buttons.

**Architecture:** A pure `hasDeliverablePayload` guard + a reusable `ErrorBoundary` + `app/error.tsx` stop the deliverable crash and show an honest failure state. A reused chat trailing-mark (`ERROR_MARK`) + a shared `errorCodeOf` classify streaming failures. `scaffoldCompany` returns the failure _cause_ so `examplePlanBanner` is honest. A store in-flight guard disables the re-plan buttons. Failure-path only; success paths untouched.

**Tech Stack:** Next.js 16 / React 19, TypeScript, node-env Vitest.

## Global Constraints

- **Failure-path only** — no change to success generation, deliverable content, or scaffold logic.
- **No new dependency.** React error boundaries are class components (write a small one).
- **Reuse the shared seam** — chat classification goes through `errorCodeOf` (mirrors `aiErrorResponse`'s codes); don't invent parallel taxonomies.
- **Honest copy** — never "showing the saved draft" without a draft; never "check your connection" during a byte/billing outage.
- **`scaffoldCompany`'s three callers** (`finishOnboarding`, `regenerateCompany`, `advanceStage`) must keep their existing behavior (incl. piece-3's `growthSignal` on advance) when switched to the new `{ changed, failure }` return.
- `npm run format:check` before pushing.

---

## Task 1: `hasDeliverablePayload` guard (pure)

**Files:**

- Modify: `lib/ai/applyResult.ts`
- Test: `lib/ai/applyResult.test.ts` (extend)

**Interfaces:**

- Produces: `hasDeliverablePayload(t: Task, type: string): boolean` — consumed by Task 3.

- [ ] **Step 1: Write the failing test** — add to `lib/ai/applyResult.test.ts`:

```ts
import { hasDeliverablePayload } from './applyResult';
// (merge the import with the existing applyResult import if present)

describe('hasDeliverablePayload', () => {
  const T = (extra: object = {}) => ({ t: 'x', done: false, ...extra }) as any;
  it('false for a scaffold-only rich task (only kind, no payload)', () => {
    for (const type of [
      'post',
      'email',
      'legal',
      'dms',
      'calendar',
      'checklist',
      'screens',
      'sheet',
      'site',
    ]) {
      expect(hasDeliverablePayload(T(), type)).toBe(false);
    }
  });
  it('true when the payload is present', () => {
    expect(hasDeliverablePayload(T({ post: { variants: [] } }), 'post')).toBe(true);
    expect(hasDeliverablePayload(T({ email: {} }), 'email')).toBe(true);
    expect(hasDeliverablePayload(T({ dms: [{ name: 'a' }] }), 'dms')).toBe(true);
    expect(hasDeliverablePayload(T({ site: '<html>' }), 'site')).toBe(true);
  });
  it('empty arrays count as no payload', () => {
    expect(hasDeliverablePayload(T({ dms: [] }), 'dms')).toBe(false);
    expect(hasDeliverablePayload(T({ screens: [] }), 'screens')).toBe(false);
  });
  it('text types check out', () => {
    expect(hasDeliverablePayload(T({ out: 'hello' }), 'doc')).toBe(true);
    expect(hasDeliverablePayload(T({ out: '   ' }), 'doc')).toBe(false);
    expect(hasDeliverablePayload(T({}), 'prep')).toBe(false);
  });
});
```

Run: `npx vitest run lib/ai/applyResult.test.ts` → FAIL (`hasDeliverablePayload` not exported).

- [ ] **Step 2: Implement** — add to `lib/ai/applyResult.ts` (near `currentDraft`):

```ts
// True when the task actually carries its type's rendered payload — so the modal knows
// whether there's anything for the viewer to show. A scaffold-only task (just `kind`) or a
// never-generated one returns false, so a failed first run shows a failure state instead of
// crashing a viewer on an undefined payload.
export function hasDeliverablePayload(t: Task, type: string): boolean {
  switch (type) {
    case 'post':
      return !!t.post;
    case 'email':
      return !!t.email;
    case 'legal':
      return !!t.legal;
    case 'screens':
      return Array.isArray(t.screens) && t.screens.length > 0;
    case 'sheet':
      return !!t.sheet;
    case 'dms':
      return Array.isArray(t.dms) && t.dms.length > 0;
    case 'calendar':
      return !!t.calendar;
    case 'checklist':
      return Array.isArray(t.checklist) && t.checklist.length > 0;
    case 'site':
      return typeof t.site === 'string' && t.site.length > 0;
    case 'plan':
      return !!t.plan;
    default: // doc / prep / build — plain-text out
      return typeof t.out === 'string' && t.out.trim().length > 0;
  }
}
```

Run: `npx vitest run lib/ai/applyResult.test.ts` → PASS. Then `npx tsc --noEmit` (only pre-existing `firestore.rules.test.ts` errors), `npx eslint lib/ai/applyResult.ts lib/ai/applyResult.test.ts`.

- [ ] **Step 3: Commit** — `git commit -m "feat(ai): hasDeliverablePayload guard for the deliverable modal"`

---

## Task 2: `ErrorBoundary` + `app/error.tsx`

**Files:**

- Create: `components/ErrorBoundary.tsx`, `app/error.tsx`

**Interfaces:**

- Produces: `<ErrorBoundary fallback={...} resetKey?={...}>` — consumed by Task 3.

- [ ] **Step 1: `components/ErrorBoundary.tsx`**

```tsx
'use client';
import React from 'react';

// A minimal reusable error boundary (React error boundaries must be class components).
// Renders `fallback` when a child throws. `resetKey` lets a parent clear the error when
// the relevant inputs change (e.g. a retry that swaps the payload in).
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode; resetKey?: unknown },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }
  componentDidCatch(err: unknown) {
    console.error('[ErrorBoundary]', err);
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
```

- [ ] **Step 2: `app/error.tsx`** (Next.js route-level boundary — last-resort backstop)

```tsx
'use client';
// App-level error boundary: nothing can take the whole app to a blank "Application error"
// screen — worst case is this contained, recoverable panel.
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'var(--page, #0b0714)',
        color: 'var(--t-1, #F5F3FF)',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 380 }}>
        <div style={{ fontSize: 18, fontWeight: 650 }}>Something went wrong.</div>
        <div style={{ fontSize: 13.5, opacity: 0.7, marginTop: 8, lineHeight: 1.5 }}>
          byte hit an unexpected error. Your work is saved — try again, or reload the page.
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 18 }}>
          <button
            onClick={reset}
            style={{
              fontFamily: 'inherit',
              fontSize: 13.5,
              fontWeight: 600,
              padding: '9px 20px',
              borderRadius: 9,
              border: 0,
              cursor: 'pointer',
              color: '#0B0616',
              background: '#7DE3FF',
            }}
          >
            Try again
          </button>
          <button
            onClick={() => location.reload()}
            style={{
              fontFamily: 'inherit',
              fontSize: 13.5,
              fontWeight: 600,
              padding: '9px 20px',
              borderRadius: 9,
              cursor: 'pointer',
              color: 'inherit',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.2)',
            }}
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify + commit** — `npx tsc --noEmit`, `npx eslint components/ErrorBoundary.tsx app/error.tsx`, `npx vitest run`. Commit: `git commit -m "feat(ui): reusable ErrorBoundary + app-level error boundary"`

---

## Task 3: Deliverable modal failure state (no crash)

**Files:**

- Modify: `components/artifact/ArtifactModal.tsx`

**Interfaces:**

- Consumes: `hasDeliverablePayload` (Task 1), `ErrorBoundary` (Task 2), the existing `genStatus`/`genError`/`liveErrorMsg`/`startRun`/`ViewerOnce`.

- [ ] **Step 1: Imports** — add:

```ts
import {
  LIVE_TYPES,
  liveKind,
  currentDraft,
  applyResult,
  hasDeliverablePayload,
} from '@/lib/ai/applyResult';
import { ErrorBoundary } from '@/components/ErrorBoundary';
```

(Merge `hasDeliverablePayload` into the existing `applyResult` import line.)

- [ ] **Step 2: A shared failure-state element** — near the render (before the `return`), compute:

```tsx
const hasPayload = hasDeliverablePayload(t, type);
const failureState = (
  <div className="artifact">
    <div className="art-body" style={{ padding: '18px 4px' }}>
      <div style={{ fontSize: 14.5, fontWeight: 650, color: 'var(--t-1)' }}>
        byte couldn’t generate this right now
      </div>
      <div style={{ fontSize: 13, color: 'var(--t-3)', marginTop: 6, lineHeight: 1.5 }}>
        {liveErrorMsg}
      </div>
      <button className="btn" style={{ marginTop: 14 }} onClick={startRun}>
        Retry
      </button>
    </div>
  </div>
);
```

- [ ] **Step 3: Guard the rich-type branch** — replace the final `else` branch that renders `<ViewerOnce>` (the one after the loading check, currently showing the "Couldn't reach byte just now — showing the saved draft" note + `<ViewerOnce item={item} .../>`) with:

```tsx
        ) : LIVE_TYPES.has(type) && genStatus === 'error' && !hasPayload ? (
          failureState
        ) : (
          <>
            {LIVE_TYPES.has(type) && genStatus === 'done' && (
              <div style={{ fontSize: 12, color: 'var(--accent-deep)', marginBottom: 10 }}>
                ✦ Written live by byte · Claude
              </div>
            )}
            {LIVE_TYPES.has(type) && genStatus === 'error' && hasPayload && (
              <div style={{ fontSize: 12, color: 'var(--clay)', marginBottom: 10 }}>
                Couldn’t reach byte just now — showing the saved draft.
              </div>
            )}
            <ErrorBoundary fallback={failureState} resetKey={`${type}:${genStatus}:${hasPayload}`}>
              <ViewerOnce item={item} onReady={() => setDeliverReady(true)} />
            </ErrorBoundary>
          </>
        )}
```

- [ ] **Step 4: Guard the text-type branch** — in the FIRST branch (the `t.out` / `TypeOut` block), when `genStatus === 'error'` and `!hasPayload`, render `failureState` instead of `<TypeOut text={t.out} .../>` (an empty `out` would otherwise be a blank body). Wrap only the `TypeOut` line:

```tsx
{
  LIVE_TYPES.has(type) && genStatus === 'error' && !hasPayload ? (
    failureState
  ) : (
    <TypeOut text={t.out} onDone={() => setDeliverReady(true)} />
  );
}
```

(Keep the `liveErrorMsg` note above it only when `hasPayload`.)

- [ ] **Step 5: Verify + commit** — `npx tsc --noEmit`, `npx eslint components/artifact/ArtifactModal.tsx` (0 errors, 0 new warnings), `npx vitest run`, `npm run format:check`. Commit: `git commit -m "fix(artifact): failed first-run shows a retry state, never crashes the viewer"`

---

## Task 4: Chat tells the truth during an outage

**Files:**

- Modify: `lib/ai/client.ts`, `app/api/chat/route.ts`, `lib/ai/chat.ts`
- Test: `lib/ai/client.test.ts` (extend)

**Interfaces:**

- Produces: `errorCodeOf(err, fallbackCode): string`; an `ERROR_MARK` stream signal → `ChatError`.

- [ ] **Step 1: `errorCodeOf` in `lib/ai/client.ts` (+ test first)**

Add to `lib/ai/client.test.ts`:

```ts
import { errorCodeOf, GenerationError } from './client';

describe('errorCodeOf', () => {
  it('maps GenerationError kinds', () => {
    expect(errorCodeOf(new GenerationError({ kind: 'billing' }), 'x')).toBe('ai_unavailable');
    expect(errorCodeOf(new GenerationError({ kind: 'refused' }), 'x')).toBe('refused');
    expect(errorCodeOf(new GenerationError({ kind: 'not_configured' }), 'x')).toBe(
      'not_configured',
    );
    expect(errorCodeOf(new GenerationError({ kind: 'upstream', status: 500 }), 'fb')).toBe('fb');
  });
  it('classifies a raw credit/billing error to ai_unavailable', () => {
    expect(errorCodeOf({ status: 400, message: 'credit balance is too low' }, 'fb')).toBe(
      'ai_unavailable',
    );
  });
  it('unknown error → fallback', () => {
    expect(errorCodeOf(new Error('boom'), 'fb')).toBe('fb');
  });
});
```

Implement in `lib/ai/client.ts` (after `aiErrorResponse`, reusing `errorInfo`/`classifyFailureKind`):

```ts
// The error *code* a caught error maps to — mirrors aiErrorResponse's body codes, for
// callers that need the code without an HTTP Response (e.g. classifying a mid-stream chat
// failure so the client shows the honest message instead of "check your connection").
export function errorCodeOf(err: unknown, fallbackCode: string): string {
  if (err instanceof GenerationError) {
    switch (err.failure.kind) {
      case 'not_configured':
        return 'not_configured';
      case 'refused':
        return 'refused';
      case 'empty':
        return 'empty';
      case 'parse_failed':
        return 'parse_failed';
      case 'billing':
        return 'ai_unavailable';
      case 'upstream':
        return fallbackCode;
    }
  }
  const { status, message } = errorInfo(err);
  return classifyFailureKind(status, message) === 'billing' ? 'ai_unavailable' : fallbackCode;
}
```

Run: `npx vitest run lib/ai/client.test.ts` → PASS.

- [ ] **Step 2: `app/api/chat/route.ts` — emit an error mark instead of `controller.error`**

Add the constant near the top (alongside where the route builds `ACTION_MARK`/`BUILD_MARK` marks — define it locally to match the client):

```ts
const ERROR_MARK = String.fromCharCode(0x1c);
```

Add `errorCodeOf` to the `@/lib/ai/client` import. Replace the stream `catch` block:

```ts
        } catch (err) {
          console.error('[chat] stream failed', err);
          const code = errorCodeOf(err, 'ai_unavailable');
          try {
            controller.enqueue(encoder.encode(ERROR_MARK + JSON.stringify({ code })));
            controller.close();
          } catch {
            controller.error(err); // stream already torn down — nothing else to do
          }
          return;
        }
```

- [ ] **Step 3: `lib/ai/chat.ts` — recognize `ERROR_MARK` → throw `ChatError`**

Add the constant next to `ACTION_MARK`/`BUILD_MARK`:

```ts
const ERROR_MARK = String.fromCharCode(0x1c);
```

In the read loop, add `ERROR_MARK` to the marker search and an `erroring` accumulation path symmetric to `acting`:

```ts
let erroring = false; // inside the ERROR_MARK JSON payload
// ...inside the while loop, alongside `if (acting) { buf += chunk; continue; }`:
if (erroring) {
  buf += chunk;
  continue;
}
// ...in the marker detection, also compute:
const eIdx = combined.indexOf(ERROR_MARK);
// include eIdx in the "earliest marker wins" selection, and handle it:
// when firstIdx === eIdx:
//   const before = combined.slice(0, eIdx);
//   if (before) yield { type: 'text', text: before };
//   buf = combined.slice(eIdx + ERROR_MARK.length);
//   erroring = true;
// ...after the while loop, BEFORE the existing `if (acting && buf)` block:
if (erroring) {
  let code = 'ai_unavailable';
  try {
    const e = JSON.parse(buf) as { code?: unknown };
    if (typeof e.code === 'string' && e.code) code = e.code;
  } catch {
    /* keep the default */
  }
  throw new ChatError(code);
}
```

(The exact wiring mirrors the `ACTION_MARK` handling already in the file — same "earliest marker wins" logic, one more branch. The `ChatError` propagates to the store's existing `errCode` bucketing, which shows "byte is temporarily unavailable" for `ai_unavailable` instead of the network message.)

- [ ] **Step 4: Verify + commit** — `npx tsc --noEmit`, `npx eslint lib/ai/client.ts app/api/chat/route.ts lib/ai/chat.ts lib/ai/client.test.ts`, `npx vitest run`. Commit: `git commit -m "fix(chat): classify mid-stream failures so an outage isn't shown as a network error"`

---

## Task 5: Overview banner honest about the cause

**Files:**

- Modify: `lib/ai/scaffold.ts`, `lib/examplePlan.ts` (+ `lib/examplePlan.test.ts`), `lib/store.tsx`, `components/views/OverviewView.tsx`, `components/views/CompanyView.tsx`

**Interfaces:**

- `scaffoldCompany(...) : Promise<{ changed: number; failure: string | null }>` (was `Promise<number>`).
- `examplePlanBanner({ planTailored, scaffoldFailure })`.

- [ ] **Step 1: `scaffoldCompany` returns the cause** — `lib/ai/scaffold.ts`:

```ts
export async function scaffoldCompany(
  companyId: string,
  brief?: CompanyBrief,
): Promise<{ changed: number; failure: string | null }> {
  try {
    const res = await fetch('/api/scaffold', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ brief }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { changed: 0, failure: data.error || 'generation_failed' };
    }
    const data = (await res.json()) as { scaffold?: { departments?: ScaffoldDept[] } };
    const generated = data.scaffold?.departments ?? [];
    if (!generated.length) return { changed: 0, failure: 'empty' };
    const changed = applyScaffold(generated);
    if (!changed.length) return { changed: 0, failure: 'empty' };
    await persistScaffold(companyId, changed).catch((err) =>
      console.error('[scaffold] persist failed', err),
    );
    return { changed: changed.length, failure: null };
  } catch (err) {
    console.error('[scaffold] failed', err);
    return { changed: 0, failure: 'network' };
  }
}
```

- [ ] **Step 2: `examplePlanBanner` cause-aware** — `lib/examplePlan.ts` (rewrite the function; update `examplePlan.test.ts` to the new truth table first):

```ts
export function examplePlanBanner(opts: {
  planTailored: boolean;
  scaffoldFailure: string | null;
}): ExamplePlanBanner | null {
  if (opts.planTailored) return null;
  if (!opts.scaffoldFailure) {
    return {
      text: 'Example company — byte hasn’t tailored this map to your product yet.',
      cta: 'Generate my plan',
    };
  }
  const text =
    opts.scaffoldFailure === 'refused'
      ? 'byte couldn’t tailor this one — try again. This is still an example, not your plan.'
      : opts.scaffoldFailure === 'rate_limited'
        ? 'You’ve hit today’s limit — it resets tomorrow. This is still an example, not your plan.'
        : 'byte couldn’t reach the model — this is an example company, not your plan yet.';
  return { text, cta: 'Retry' };
}
```

Update `examplePlan.test.ts`: `planTailored` → null; `scaffoldFailure:null` → "Generate my plan"; `'refused'` / `'rate_limited'` / `'ai_unavailable'` (and any other) → their copy + "Retry".

- [ ] **Step 3: `lib/store.tsx` — `scaffoldFailure` state + caller updates**

- Type: change `scaffoldFailed: boolean` → `scaffoldFailure: string | null` in `AppState`.
- State: `const [scaffoldFailure, setScaffoldFailure] = useState<string | null>(null);` (replace the `scaffoldFailed` useState).
- `finishOnboarding`: `const { changed, failure } = await scaffoldCompany(...)`; on `!changed` → `setScaffoldFailure(failure)`; on success leave null. Same for the enrich-interview `.then(({ changed, failure }) => ...)` branch.
- `regenerateCompany`: `.then(({ changed, failure }) => { if (changed) { ...; setScaffoldFailure(null); } else { setScaffoldFailure(failure); } })`.
- `advanceStage`: change `.then((changed) => ...)` to `.then(({ changed }) => ...)` — it only reads `changed` (keep the piece-3 `beforeLater`/`unlockedKeys`/`growthSignal` and the rollback exactly as-is).
- Expose `scaffoldFailure` on the two `value` memos (replacing `scaffoldFailed`).

- [ ] **Step 4: consumers** — `OverviewView.tsx`: destructure `scaffoldFailure` (not `scaffoldFailed`) and call `examplePlanBanner({ planTailored, scaffoldFailure })`. `CompanyView.tsx`: if it reads `scaffoldFailed`, update likewise (grep to confirm; it may only use `regenerateCompany`).

- [ ] **Step 5: Verify + commit** — `npx tsc --noEmit`, `npx eslint` the changed files, `npx vitest run` (incl. examplePlan test), `npm run format:check`. Commit: `git commit -m "fix(overview): example-plan banner states the real failure cause"`

---

## Task 6: Scaffold retry can't be hammered

**Files:**

- Modify: `lib/store.tsx`, `components/views/OverviewView.tsx`, `components/views/CompanyView.tsx`

- [ ] **Step 1: `lib/store.tsx` — in-flight guard + `regenerating` state**

- Add `regenerating: boolean` to `AppState`; `const [regenerating, setRegenerating] = useState(false);` + `const regenInFlightRef = useRef(false);`.
- In `regenerateCompany` (the `useCallback`): at the top, `if (regenInFlightRef.current || !companyId) return; regenInFlightRef.current = true; setRegenerating(true);` and clear both in a `.finally(() => { regenInFlightRef.current = false; setRegenerating(false); })` on the `scaffoldCompany(...).then(...)` chain. (`setRegenerating`/`regenInFlightRef` are stable — do NOT add to the `useCallback` deps.)
- Expose `regenerating` on both `value` memos.

- [ ] **Step 2: disable the buttons** — `OverviewView.tsx`: the example-plan `<button onClick={regenerateCompany}>` gets `disabled={regenerating}` and a busy label (`{regenerating ? 'Re-planning…' : examplePlan.cta}`). `CompanyView.tsx`: the `.replan` button gets `disabled={regenerating}` (destructure `regenerating` from `useApp()`), label "Re-planning…" while busy.

- [ ] **Step 3: Verify + commit** — `npx tsc --noEmit`, `npx eslint lib/store.tsx components/views/OverviewView.tsx components/views/CompanyView.tsx` (0 errors, 0 new warnings — the `useCallback` deps must be unchanged), `npx vitest run`, `npm run format:check`. Commit: `git commit -m "fix(overview): disable the re-plan button while a scaffold is in flight"`

---

## Self-Review Notes (author checklist — done)

- **Spec coverage:** crash → Tasks 1–3 (guard + failure state + boundary + `app/error.tsx`); chat honesty → Task 4 (`errorCodeOf` + `ERROR_MARK`); banner honesty → Task 5 (`scaffoldCompany` cause + cause-aware banner); retry guard → Task 6.
- **Type consistency:** `hasDeliverablePayload`/`errorCodeOf`/`examplePlanBanner` new signatures match every call site listed; `scaffoldCompany`'s `{ changed, failure }` updated in all three callers.
- **No placeholders:** full code for new files/pure helpers; exact edits (with the surrounding code named) for the modifications.
- **Renderer/store safety:** the `ERROR_MARK` path mirrors the existing `ACTION_MARK` handling; `regenerating` setState lives in an action/`.finally`, not an effect body; stable setters kept out of `useCallback` deps; piece-3 `growthSignal` preserved in `advanceStage`.
- **Honest copy everywhere:** failure state only where there's no draft; "saved draft" note gated on `hasPayload`; banner cause-aware.

```

```
