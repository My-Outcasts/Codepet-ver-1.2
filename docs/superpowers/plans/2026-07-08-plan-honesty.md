# Plan honesty — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The map never claims a "tailored" plan when it's really the Codepet seed — no fake-tailor from a placeholder, no partial scaffold passing as complete, no success toast on a failed scaffold, and a real path to add a brief after skipping.

**Architecture:** The scaffold route reads the request-body brief (like `/api/personalize`) and returns an empty _neutral_ scaffold when there's no real brief (no more `CODEPET_CONTEXT`). A pure `coversAllDepartments` guard makes scaffolds all-or-nothing. The banner CTA reopens onboarding when there's no brief. The onboarding toast is gated on the real reveal result.

**Tech Stack:** Next.js 16 / React 19, TypeScript, node-env Vitest.

## Global Constraints

- **Honest by construction:** `planTailored` is stamped only on a scaffold grounded in a real brief AND covering every department. A brief-less scaffold is neutral (banner "Generate my plan"); a partial one is a failure (`'incomplete'`, kept as example + Retry).
- **Normal onboarding still tailors** — sourced from `body.brief` (robust to persist timing).
- **`scaffoldCompany`'s `{ changed, failure }` contract unchanged** — new `failure` value `'incomplete'`; `null` for the `noBrief` case (neutral, not an error).
- No change to the scaffold's task generation, the department set, the map render, or deliverables. No Settings brief editor (reopen onboarding is the escape). No P1-B / P2 / P3 items.
- `npm run format:check` before pushing.

---

## Task 1: Scaffold honesty — no fake-tailor + all-or-nothing coverage

**Files:**

- Modify: `app/api/scaffold/route.ts`
- Modify: `lib/ai/scaffold.ts`
- Test: `lib/ai/scaffold.test.ts` (create or extend)

**Interfaces:**

- Produces: `coversAllDepartments(generated): boolean` (pure) + the route's `noBrief` response + `scaffoldCompany`'s `noBrief`/`incomplete` handling.

- [ ] **Step 1: Write the failing test** — create/extend `lib/ai/scaffold.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { coversAllDepartments } from './scaffold';
import { DEPTS_SEED } from '../data';

describe('coversAllDepartments', () => {
  const allKeys = DEPTS_SEED.map((d) => ({ k: d.k }));
  it('true when every department key is present', () => {
    expect(coversAllDepartments(allKeys)).toBe(true);
  });
  it('false when any department key is missing', () => {
    expect(coversAllDepartments(allKeys.slice(1))).toBe(false);
  });
  it('false for an empty array', () => {
    expect(coversAllDepartments([])).toBe(false);
  });
  it('extra/unknown keys still pass as long as all real ones are present', () => {
    expect(coversAllDepartments([...allKeys, { k: 'bogus' }])).toBe(true);
  });
});
```

Run: `npx vitest run lib/ai/scaffold.test.ts` → FAIL (`coversAllDepartments` not exported).

- [ ] **Step 2: Add `coversAllDepartments` to `lib/ai/scaffold.ts`**

Add the import + pure helper at the top (after the existing imports):

```ts
import { DEPTS_SEED } from '../data';

// All-or-nothing coverage: only a scaffold that returned an entry for EVERY department is a
// real tailoring. A partial one would leave some departments on the Codepet seed while the
// map claims to be tailored — so we reject it (keep the example, offer Retry) rather than
// mislabel it.
export function coversAllDepartments(generated: { k?: unknown }[]): boolean {
  const keys = new Set(generated.map((g) => g.k));
  return DEPTS_SEED.every((d) => keys.has(d.k));
}
```

Run: `npx vitest run lib/ai/scaffold.test.ts` → PASS.

- [ ] **Step 3: Wire `noBrief` + coverage into `scaffoldCompany`**

In `scaffoldCompany`, change the success-branch parsing (after the `if (!res.ok)` block) to:

```ts
const data = (await res.json()) as {
  scaffold?: { departments?: ScaffoldDept[] };
  noBrief?: boolean;
};
// No real brief to tailor from → neutral (not a failure): the example seed stands and
// the banner invites "Generate my plan".
if (data.noBrief) return { changed: 0, failure: null };
const generated = data.scaffold?.departments ?? [];
if (!generated.length) return { changed: 0, failure: 'empty' };
// All-or-nothing: a partial scaffold would leave Codepet seed in the missing departments.
if (!coversAllDepartments(generated)) return { changed: 0, failure: 'incomplete' };

const changed = applyScaffold(generated);
if (!changed.length) return { changed: 0, failure: 'empty' };
// ...unchanged persist + return { changed: changed.length, failure: null }
```

- [ ] **Step 4: Scaffold route — read `body.brief`, drop `CODEPET_CONTEXT`, empty on no brief, `minItems`**

In `app/api/scaffold/route.ts`:

(a) **Remove** the `const CODEPET_CONTEXT = ...` line.

(b) After the `getClient()` block, parse the optional body:

```ts
let body: { brief?: unknown } = {};
try {
  body = (await req.json()) as { brief?: unknown };
} catch {
  // body is optional; the server-loaded brief is preferred anyway
}
```

(c) Change the context line + add the no-brief early return (mirrors `/api/personalize`):

```ts
const context = briefToContext(serverBrief) ?? briefToContext(body.brief);
if (!context) {
  // No real brief anywhere → don't invent a company. Keep the honest example seed.
  return Response.json({ scaffold: { departments: [] }, noBrief: true });
}
```

(d) In `SCAFFOLD_SCHEMA`, add `minItems` to the `departments` array so the model must return
an entry per department:

```ts
    departments: {
      type: 'array',
      minItems: DEPT_KEYS.length,
      items: { /* ...unchanged... */ },
    },
```

- [ ] **Step 5: Verify + commit**

Run: `npx tsc --noEmit` (only the pre-existing `firestore.rules.test.ts` errors), `npx eslint app/api/scaffold/route.ts lib/ai/scaffold.ts lib/ai/scaffold.test.ts` (0 errors, 0 new warnings), `npx vitest run` (all pass).

```bash
git add app/api/scaffold/route.ts lib/ai/scaffold.ts lib/ai/scaffold.test.ts
git commit -m "fix(scaffold): no brief → keep the honest example (no CODEPET_CONTEXT); partial scaffold = incomplete"
```

---

## Task 2: Banner copy for `'incomplete'`

**Files:**

- Modify: `lib/examplePlan.ts`
- Test: `lib/examplePlan.test.ts`

- [ ] **Step 1: Add the failing test** — in `lib/examplePlan.test.ts`, add:

```ts
it('incomplete cause → couldn’t-finish copy + Retry', () => {
  const b = examplePlanBanner({ planTailored: false, scaffoldFailure: 'incomplete' });
  expect(b?.cta).toBe('Retry');
  expect(b?.text.toLowerCase()).toContain('finish');
});
```

Run: `npx vitest run lib/examplePlan.test.ts` → FAIL.

- [ ] **Step 2: Add the `'incomplete'` branch** — in `lib/examplePlan.ts`, extend the `text` ternary:

```ts
const text =
  opts.scaffoldFailure === 'refused'
    ? 'byte couldn’t tailor this one — try again. This is still an example, not your plan.'
    : opts.scaffoldFailure === 'incomplete'
      ? 'byte couldn’t finish tailoring your map — try again. This is still an example, not your plan.'
      : opts.scaffoldFailure === 'rate_limited'
        ? 'You’ve hit today’s limit — it resets tomorrow. This is still an example, not your plan.'
        : 'byte couldn’t reach the model — this is an example company, not your plan yet.';
```

Run: `npx vitest run lib/examplePlan.test.ts` → PASS. Then `npx tsc --noEmit`, `npx eslint lib/examplePlan.ts lib/examplePlan.test.ts`.

- [ ] **Step 3: Commit** — `git commit -m "fix(overview): example-plan banner copy for an incomplete scaffold"`

---

## Task 3: `openOnboarding` store action

**Files:**

- Modify: `lib/store.tsx`

**Interfaces:**

- Produces: `openOnboarding: () => void` on `useApp()` — consumed by Task 4.

- [ ] **Step 1: Type + action + expose**

- In `AppState` (near `finishOnboarding`), add: `openOnboarding: () => void;`
- Add the action near `finishOnboarding`: `const openOnboarding = useCallback(() => setOnboarding(true), []);` (`setOnboarding` is a stable setter — deps `[]`).
- Add `openOnboarding` to the provider `value` (object + its `useMemo` dep array).

- [ ] **Step 2: Verify + commit** — `npx tsc --noEmit`, `npx eslint lib/store.tsx` (0 errors/0 new warnings; deps of other callbacks unchanged), `npx vitest run`. Commit: `git commit -m "feat(store): openOnboarding action (reopen the wizard to add a brief)"`

---

## Task 4: Banner CTA reopens onboarding when there's no brief

**Files:**

- Modify: `components/views/OverviewView.tsx`

**Interfaces:**

- Consumes: `openOnboarding` (Task 3), `regenerateCompany`, `brief` (all from `useApp()`).

- [ ] **Step 1: Destructure `openOnboarding`** from `useApp()` (alongside `regenerateCompany`, `brief`, `regenerating`, `planTailored`, `scaffoldFailure`).

- [ ] **Step 2: Derive `hasBrief`** near where `examplePlan` is computed:

```ts
const hasBrief = !!(brief.oneLiner?.trim() || brief.summary?.trim() || brief.projectName?.trim());
```

- [ ] **Step 3: Route the CTA** — change the example-plan banner button's `onClick={regenerateCompany}` to:

```tsx
              onClick={() => (hasBrief ? regenerateCompany() : openOnboarding())}
```

(Everything else on the button — the `disabled={regenerating}`, the `{regenerating ? 'Re-planning…' : examplePlan.cta}` label — stays. When there's no brief the label is "Generate my plan" and it now opens the wizard; when a brief exists it's "Generate my plan"/"Retry" and re-plans.)

- [ ] **Step 4: Verify + commit** — `npx tsc --noEmit`, `npx eslint components/views/OverviewView.tsx` (0 errors, no new warnings), `npx vitest run`. Commit: `git commit -m "fix(overview): 'Generate my plan' reopens onboarding when there's no brief"`

---

## Task 5: Onboarding success toast gated on the real result

**Files:**

- Modify: `components/Onboarding.tsx`

- [ ] **Step 1: Gate the toast on `reveal.ok`** — replace `finish()`'s toast:

```tsx
const finish = () => {
  finishOnboarding(briefFromData(data));
  const ok = reveal?.ok;
  setTimeout(
    () =>
      toast(
        ok
          ? 'Your roadmap is ready — byte mapped your company across your departments.'
          : 'You’re in — I’ll tailor your map as soon as byte’s back. For now it’s an example you can regenerate anytime.',
      ),
    400,
  );
};
```

(`reveal` is the `RevealSummary | null` state already set by `scaffoldFromOnboarding` during the wizard's analysis step; `finish()` just reads its `.ok`.)

- [ ] **Step 2: Verify + commit** — `npx tsc --noEmit`, `npx eslint components/Onboarding.tsx` (0 errors, no new warnings), `npx vitest run`, `npm run format:check`. Commit: `git commit -m "fix(onboarding): don't claim 'roadmap ready' when the scaffold failed"`

---

## Self-Review Notes (author checklist — done)

- **Spec coverage:** no-fake-tailor → Task 1 (body.brief + no-context empty + remove CODEPET_CONTEXT); all-or-nothing coverage → Task 1 (`coversAllDepartments` + minItems); incomplete copy → Task 2; escape the one-way door → Task 3 + 4 (`openOnboarding` + CTA routing); honest toast → Task 5.
- **Type consistency:** `coversAllDepartments(generated)` matches `ScaffoldDept[]`/`{k}` shape; `scaffoldCompany`'s `{ changed, failure }` unchanged (new value `'incomplete'`, `null` for noBrief); `openOnboarding: () => void` matches `setOnboarding(true)`.
- **No placeholders:** full code / exact edits everywhere.
- **Lint traps:** `openOnboarding` useCallback deps `[]` (stable setter); no dep-array changes to other callbacks; no set-state-in-effect.
- **Coexistence:** normal onboarding tailors via body.brief; `advanceStage` growthSignal, regenerate in-flight guard, P0 failure states untouched.

```

```
