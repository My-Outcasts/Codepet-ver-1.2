# Plan honesty — never claim a tailored map when it's the seed (audit P1-A)

**Date:** 2026-07-08
**Scope:** The scaffold → `planTailored` → example-plan-banner honesty path, plus the
onboarding skip/toast. No change to the scaffold's per-department generation, the map
render, or deliverables. From the whole-app gap audit's P1 tier (honesty half).
**Status:** Design approved (brainstorm), ready for implementation plan.

## Problem

The app promises "never let a seeded map pass for a tailored plan" but breaks it in three
ways (confirmed on `main`):

1. **Skipping onboarding fakes a tailored company.** `app/api/scaffold/route.ts:179` does
   `briefToContext(serverBrief) ?? CODEPET_CONTEXT` (`= "a founder building their company
with Codepet"`), and the route **never reads the request-body brief** — so a brief-less
   call scaffolds a company _for Codepet itself_, and the client stamps `planTailored=true`
   (banner clears). There's also no way to add a brief after skipping — a one-way door into
   a permanently generic company.
2. **Partial scaffolds pass as fully tailored.** `SCAFFOLD_SCHEMA`'s `departments` array has
   no coverage constraint, and `applyScaffold` only mutates the keys the model returned — so
   a scaffold that drops a department leaves that department's **Codepet seed content**, yet
   `scaffoldCompany` returns `changed > 0` and the store flips `planTailored=true` globally.
3. **The onboarding success toast fires even when the scaffold failed.**
   `components/Onboarding.tsx:242-248` — `finish()` always toasts "Your roadmap is ready —
   byte mapped your company…", ignoring `reveal.ok`; on a failed scaffold the founder lands
   on the map one beat later to the honest "example company, not your plan yet" banner —
   directly contradicting the toast.

Root cause (from the audit): `planTailored` is a global boolean set on `changed > 0`, with
no check that the scaffold was grounded in a real brief AND covered every department.

## Approach (chosen from brainstorm)

Four coupled fixes; behavior/copy only, no new visual UI.

### 1. No real brief → never fake-tailor

`app/api/scaffold/route.ts`:

- Parse the request body (optional) and source the brief like `/api/personalize` does:
  `const context = briefToContext(serverBrief) ?? briefToContext(body.brief);`
- If `!context` → return **an empty, neutral scaffold**:
  `return Response.json({ scaffold: { departments: [] }, noBrief: true });`
  (so a brief-less call keeps the honest example seed instead of a Codepet company).
- **Remove `CODEPET_CONTEXT`** entirely.

`lib/ai/scaffold.ts` (`scaffoldCompany`, already returns `{ changed, failure }`):

- `data.noBrief` → `{ changed: 0, failure: null }` — **neutral** (no attempt), so the banner
  reads "Generate my plan," not an error.

### 2. Partial scaffold = not tailored (all-or-nothing)

`app/api/scaffold/route.ts`: add `minItems: DEPT_KEYS.length` to the `departments` array
schema (the model must return an entry for every department).

`lib/ai/scaffold.ts`: a **pure, unit-tested** coverage guard before applying:

```ts
import { DEPTS_SEED } from '../data';
export function coversAllDepartments(generated: { k?: unknown }[]): boolean {
  const keys = new Set(generated.map((g) => g.k));
  return DEPTS_SEED.every((d) => keys.has(d.k));
}
```

In `scaffoldCompany`, after reading `generated` and before `applyScaffold`: if
`!coversAllDepartments(generated)` → `return { changed: 0, failure: 'incomplete' }`
(do **not** apply a partial — the example seed stays, banner offers Retry). So
`planTailored` is stamped only on a scaffold that covered every department.

### 3. "Generate my plan" with no brief → reopen onboarding (escape the one-way door)

`lib/store.tsx`: add `openOnboarding: () => void` (`setOnboarding(true)`), exposed on the
context value.

`components/views/OverviewView.tsx`: the example-plan banner CTA routes by whether a
usable brief exists:

- **no brief** (skipped) → `openOnboarding()` — collect the brief in the wizard, which then
  scaffolds; no more no-op / fake scaffold.
- **has a brief** (the "Retry" state after a failure, or a returning account) →
  `regenerateCompany()`.
  `hasBrief` is derived in `OverviewView` from real product signal
  (`brief.oneLiner?.trim() || brief.summary?.trim() || brief.projectName?.trim()`).

### 4. Success toast gated on success

`components/Onboarding.tsx` `finish()`: gate the toast on the wizard's `reveal.ok`:

- `reveal?.ok` → "Your roadmap is ready — byte mapped your company across your departments."
- else → an honest line, e.g. "You're in — I'll tailor your map as soon as byte's back.
  For now it's an example you can regenerate anytime."
  (The `reveal` state is already set by `scaffoldFromOnboarding` during the wizard's analysis
  step; `finish()` just reads it.)

### Banner copy for `'incomplete'`

`lib/examplePlan.ts` (+ `examplePlan.test.ts`): add the `'incomplete'` cause →
"byte couldn't finish tailoring your map — Retry." (`refused`/`rate_limited`/reach-fail
branches unchanged.)

## Files

- **Modify** `app/api/scaffold/route.ts` — body.brief source + no-context→empty(`noBrief`) + remove `CODEPET_CONTEXT` + `minItems`.
- **Modify** `lib/ai/scaffold.ts` (+ new `scaffold.test.ts` or extend) — `coversAllDepartments` + `noBrief`/`incomplete` handling in `scaffoldCompany`.
- **Modify** `lib/examplePlan.ts` (+ `examplePlan.test.ts`) — `'incomplete'` copy.
- **Modify** `lib/store.tsx` — `openOnboarding` action + expose.
- **Modify** `components/Onboarding.tsx` — toast gated on `reveal.ok`.
- **Modify** `components/views/OverviewView.tsx` — banner CTA routes by `hasBrief`.

## Coexistence (unchanged, must keep working)

The normal onboarding path (a real brief) still scaffolds and tailors (now sourced from
`body.brief`, robust to persist timing). `advanceStage`'s piece-3 `growthSignal` + rollback,
`regenerateCompany`'s in-flight guard, the P0 byte-down failure states, the tailored/failed
banner states, and the map render are untouched. `scaffoldCompany`'s `{ changed, failure }`
contract is unchanged (new `failure` values `'incomplete'`; `null` for `noBrief`).

## Edge cases

- **Skip onboarding** → no brief → route empty(`noBrief`) → banner "Generate my plan" →
  reopen onboarding → complete → tailored. (Door closed.)
- **Onboarding with a real brief** → `body.brief` gives context → full scaffold → tailored;
  toast honest.
- **Scaffold drops a department** → `coversAllDepartments` false → `'incomplete'` → seed kept,
  banner "…couldn't finish tailoring… Retry," `planTailored` stays false.
- **Model unreachable during scaffold** → existing P0 failure code (`ai_unavailable` etc.) →
  banner "couldn't reach the model" (unchanged); toast honest.
- **Returning account, already tailored** (`planTailored` from `scaffoldedAt`) → no banner.
- **Thin brief that `briefToContext` rejects** → treated as no brief → reopen onboarding.

## Testing

- **Unit (node-env Vitest):**
  - `coversAllDepartments` — true when every `DEPTS_SEED.k` is present; false when any is
    missing; false for `[]`.
  - `examplePlanBanner` — the `'incomplete'` cause → its copy + "Retry"; existing rows
    unchanged; `null`/tailored rows unchanged.
- **Manual (Vercel PR preview — the model is currently down, so most of this reproduces):**
  skip onboarding → banner "Generate my plan" → clicking it reopens the wizard (not a fake
  scaffold); complete a real brief → tailored map, honest toast; a scaffold that fails to
  cover all departments keeps the example + "couldn't finish tailoring — Retry"; a real
  brief-based scaffold still tailors as before.

## Non-goals (YAGNI)

- No change to the scaffold's task generation, department set, or the map render.
- No Settings "edit your brief" editor (reopening onboarding is the escape; a standalone
  brief editor is a separate future idea).
- No persistence-resilience fixes (silent draft/approve writes, onboarding progress) — that's
  **P1-B**, the next tranche.
- No P2/P3 audit items.

## Dependencies & sequencing

Builds off `origin/main` (tip `1d2f73e`). Mirrors `/api/personalize`'s `body.brief`
sourcing. Standalone PR. Given concurrent sessions, isolated worktree; verify on the Vercel
preview (onboarding/first-run + scaffold are unreadable under `next dev`); run
`npm run format:check` before pushing. Next: **P1-B** (persistence resilience).
