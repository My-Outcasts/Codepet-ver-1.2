# First-Run Activation — Design

**Date:** 2026-07-03
**Status:** Approved design, pending implementation plan
**Branch:** `feat/first-run-activation` (off `origin/main` @ #36)

## Problem

Codepet's core promise is _byte does real work with you_. Today that promise is
**asserted in copy but never demonstrated** during first-run:

- The onboarding wizard's "byte is reading your project…" analysis screen (step 6)
  is a **fake animation** — four `setTimeout` lines. No real work happens there.
- The genuinely magical moment — byte generating a bespoke company from what the
  founder typed — happens **invisibly in the background** _after_ the wizard closes
  (`scaffoldCompany` runs fire-and-forget inside `finishOnboarding`). On arrival the
  user briefly sees a generic seed company, which then silently swaps.
- The wizard's summary (step 7) promises hardcoded numbers ("11 tasks across 8
  departments", "9 steps") rather than what was actually built.
- On landing there is no single, irresistible first action — the user is dropped
  into the app to find their own way.

Net: the one moment that would make someone say _"whoa, it built MY company"_ is
hidden off-screen, and the draft→approve loop is never demonstrated in the first
session.

## Goal & success bar

**Activated = the user witnesses byte produce their first real deliverable (B),
then approves it (C).**

We optimize for **B leading into C** inside the first session. Reaching the app
(the current bar) is too low — nearly everyone clears it.

## Approach (chosen)

**Approach 1 — Make the reveal real, in the wizard**, with the greeting + first-action
handoff borrowed from a lighter alternative. Reuses the already-polished wizard,
fixes the actual hole (the magic is hidden), and stays out of the concurrent
session's scaffold/`project-model` lane by touching `scaffoldCompany` only via
_awaiting it and reading its result_.

Rejected alternatives:

- **Approach 2 (cinematic live-build on the 3D map):** highest wow, but most work
  and leans hardest on the exact scaffold code another session is actively changing
  — highest collision risk.
- **Approach 3 (skip the spectacle, lead with the deliverable):** fastest to B→C but
  throws away the company-building wow and can feel abrupt without company context.

## The new first-run arc

Steps 1–5 of the wizard are unchanged (collect the brief). Everything after shifts:

1. **Step 6 becomes real.** Entering it kicks off the actual `scaffoldCompany` call.
   The four progress lines still animate, but "See what I found" unlocks only when
   **both** the animation minimum has elapsed **and** scaffold has resolved. The
   wait now means something.
2. **Step 7 shows the real company.** Reads the freshly-built `DEPTS` singleton —
   actual active department names, 2–3 real first task titles, true counts —
   replacing the hardcoded promises.
3. **Landing greeting.** On arrival, byte's chat greets the founder by name, names
   the company, and offers the real `nextStep` as **one** irresistible action:
   _"Draft your landing hero — want me to do it with you?"_
4. **First action → B→C.** Click → `runTaskInChat(nextStep.deptK, nextStep.taskTitle)`
   → real deliverable appears inline in chat (**B**) with the existing Approve card
   (**C**).

## Confirmed code contracts

- `scaffoldCompany(companyId, brief)` (`lib/ai/scaffold.ts`) applies the generated
  company onto the `DEPTS` singleton and returns a **count** (0 on any failure).
  After `await`, the real company is readable directly from `DEPTS` — no change to
  scaffold's return or logic required.
- `nextStep: NextStep | null` (`{deptK, taskTitle, why}`) is already the computed
  "single best first move," produced by `computeNextStep()` / `fetchNextStep`.
- `runTaskInChat(deptK, taskTitle)` (`lib/store.tsx`) already produces a real
  deliverable **inline in chat** with an Approve card. B→C is an existing
  capability — this work only needs to _trigger_ it and _reveal_ the scaffold.
- `chatMessages` / `setChatMessages` are seedable; a `pending` run-handoff pattern
  already exists in the store.

## Components & changes

### `components/Onboarding.tsx`

- Step 6: on entry, trigger the real scaffold (via a new store action, so
  `companyId` stays in the store). Keep the progressive line animation but gate the
  advance button on `anDone && scaffoldResolved`.
- If scaffold is still running when the animation ends, hold on the last line
  ("Drafting your roadmap to launch…") with a subtle "still working…" affordance
  after a few seconds.
- Step 7: derive the summary from the real `DEPTS` — active department names, 2–3
  real first task titles, true task/department counts. No hardcoded numbers.

### `lib/store.tsx`

- New action `scaffoldFromOnboarding(brief): Promise<RevealSummary>` — runs
  `scaffoldCompany`, then builds a small reveal summary (`{deptCount, taskCount,
sampleDepts, sampleTasks}`) read from `DEPTS`. Sets a ref/flag marking scaffold
  as already done this session.
- `finishOnboarding` **stops re-scaffolding** when the wizard already did it (guard
  on the flag), to avoid a double call. It still stamps completion and persists the
  brief. (Note: `scaffoldCompany` takes the brief as a param and persists only the
  _scaffold_, not the brief — so scaffolding in step 6 before the brief is persisted
  in `finishOnboarding` is safe; no ordering hazard.)
- Seed a **first-run-only** byte greeting into `chatMessages` after `nextStep`
  resolves: addressed by `founderName`, naming the company, offering `nextStep` with
  a "Do it with me" action button. Guarded so returning users never see it.
- Ensure the Copilot chat panel is **open** (not collapsed) on first arrival so the
  greeting is visible.

### `components/Copilot.tsx`

- Wire the greeting's "Do it with me" button to `runTaskInChat(nextStep.deptK,
nextStep.taskTitle)`. Reuses the existing ResultCard (deliverable inline + Approve).

### Scaffold layer

- **Untouched** beyond being awaited — stays clear of the concurrent
  `feat/project-model` work.

## Error / slow paths (first-run never dead-ends)

- **Scaffold fails (returns 0):** keep today's behavior — the seed company stays,
  step 7 shows an **honest generic** summary (no fake numbers), the user still
  lands. The greeting uses whatever `nextStep` resolves to against the seed.
- **Scaffold slow:** hold on the last analysis line with a "still working…"
  affordance after a few seconds; a hard timeout (~20s) proceeds with the fallback
  so the user is never stuck.
- **No `nextStep`:** the greeting falls back to a warm "explore your company" nudge
  with no run button.

## Testing

- **Unit:**
  - Reveal-summary builder: `DEPTS` sample → correct counts, department names, task
    titles; and the honest-fallback shape when scaffold returned 0.
  - Step-6 unlock condition: advance enabled only when `anDone && scaffoldResolved`;
    timeout path resolves to fallback.
  - Greeting builder: `nextStep` → message with action; first-run-only guard; the
    no-`nextStep` fallback (no button).
- **Manual (localhost, real brief):** full onboarding run — real company appears in
  the step-7 summary, greeting names the founder + a real task, clicking the action
  yields a real deliverable inline, Approve works.

## Measuring activation

Reuse the existing `track()` analytics façade. Add the funnel:

- `firstrun.scaffold_shown` — real reveal viewed (step 7).
- `firstrun.action_offered` — greeting with a run action shown.
- `firstrun.action_clicked` — first action triggered (**B**).
- `firstrun.first_approve` — first deliverable approved (**C**).

`action_clicked → first_approve` over `action_offered` **is** the activation rate.

## Out of scope

- The cinematic live-build on the 3D map (Approach 2) — a possible future upgrade.
- Any change to scaffold generation quality / the project-model grounding (owned by
  the concurrent session).
- Returning-user / re-onboarding flows — this design is strictly first session.
