# Inline run transparency — watch byte work, then review as today

**Date:** 2026-07-06
**Branch:** `feat/inline-run-transparency` (off `origin/main`)
**Status:** approved design

## Problem

When a founder has byte run a task from the chat (the inline "run it from here" flow), the
result card (`ResultCard` in `components/Copilot.tsx`) shows only a bare `"Producing…"`
spinner while it works. The founder never sees byte do the work — the deliverable simply
appears, then they Approve / Read / Revise it.

This undercuts the product's core promise. The tester guide literally says *"Watch byte
**Execute → Deliver**"*, and the deliverable **modal** (`ArtifactModal`) already has a rich,
believable execution experience — a live "execute log" with streaming steps and a "Ran N
actions" counter. The inline chat path throws all of it away and shows only a spinner.

## Current behavior (for the record)

An inline run today: produce (`"Producing…"` spinner) → the card shows a **preview** + an
**Approve · Read · Revise** action row → the founder clicks **Approve** → `"Saved to your
library"`. So there is already a review-and-approve gate; the only thing missing is *seeing
byte work* before it.

## Direction (decided)

- **Goal: trust / transparency.** The founder should *see byte really do the work, step by
  step, before they review it.*
- **End behavior: watch → then review (keep the existing gate).** The visible execution log
  runs first; then the deliverable appears with the **Approve / Read / Revise** row exactly as
  today. Nothing auto-saves — the founder still approves before it's saved. This *reinforces*
  "you approve every move": they now both **see** the work and **approve** it.
- **Layout: "full log, then a lasting record" (Option C).** The card streams the live log
  while running; once the log finishes, the steps fold into a re-openable **"▸ What byte did ·
  N steps"** toggle that sits **above** the result. The toggle persists through the Approve
  gate and after "Saved to your library" — the proof-of-work survives the moment without
  cluttering the chat.
- **Scope: every inline chat run**, not just "build"-type deliverables. Consistent behavior
  everywhere byte produces a deliverable in chat.

## Non-goals

- **No change to the save/approve flow.** The existing **Approve / Read / Revise** gate stays
  exactly as it is; we neither add a new gate nor remove the current one. `approveChatResult`
  is untouched.
- No change to the deliverable **modal** flow beyond extracting its `ExecLog` for reuse.
- Execution stays **simulated** (byte isn't literally running on the machine). This is about
  showing a believable, informative process — not wiring real execution.
- Nothing in Giang's Build Coach surface. `Copilot.tsx`, `store.tsx`, `ArtifactModal.tsx`,
  and `lib/helpers.ts` are all ours.

## Global constraints

- **Reuse, don't reinvent.** The step generator `buildLog(task, type, dept): LogStep[]`
  already exists in `lib/helpers.ts` and is used by the modal — the inline log uses the
  **same** generator so the two never diverge.
- **Motion-guarded.** The streaming animation respects `prefers-reduced-motion` (skip the
  stream, show the finished log immediately) — consistent with the app's existing motion
  guardrails.
- **Honesty on failure.** A failed run must never show a success log; it keeps the current
  error behavior.

## Components

### 1. Shared `ExecLog` (extract)

`ExecLog` currently lives inside `components/artifact/ArtifactModal.tsx`. Extract it (its
`LogStep` streaming behavior — the "Ran N actions" counter, ✓ / mono / check-in rows) into a
shared `components/artifact/ExecLog.tsx`. `ArtifactModal` imports it instead of defining it;
`ResultCard` imports the same component. One component, one behavior, two consumers.

### 2. `ChatMessage.steps?: LogStep[]` (new field)

Add `steps?: LogStep[]` to `ChatMessage` in `lib/store.tsx`. The run generates the steps once
(via `buildLog`) and stores them on the message, so the live `ExecLog` streams them while
running and the collapsed **"What byte did"** toggle can re-open the exact same steps any time
(they survive a reload, since chat messages persist).

### 3. `ResultCard` — a run phase before the (unchanged) review

`ResultCard` in `components/Copilot.tsx` gains a streaming run phase and a persistent record,
without touching the review/approve states:

- **Running** → render `<ExecLog steps={m.steps} …>` streaming live, replacing the bare
  `"Producing…"` spinner.
- **Produced (not yet approved)** → a collapsed **"▸ What byte did · N steps"** toggle rendered
  **above** the existing preview + **Approve / Read / Revise** row (that row is unchanged).
- **Approved** → the same toggle above the preview + `"Saved to your library"` (unchanged).
- **Expanded** → tapping the toggle shows the full, static (all-✓) step log; tapping again
  collapses it.

`N` = `m.steps.length`. Revise re-runs keep working as they do today (they regenerate steps
the same way and stream again).

### 4. Store: attach steps + dual-gate the run→produced transition

The store action that drives the inline run:

- On start: compute `steps = buildLog(task, type, dept)` and attach to the message.
- The card leaves the **running** state only when *both* the ExecLog has finished playing *and*
  the produce has resolved (the same dual-gate the onboarding analysis screen already uses) —
  so a fast server response still shows the full log, and a slow one doesn't cut it short.
- On success → the message enters the **produced** state (preview + Approve/Read/Revise),
  `steps` retained. **No auto-approve.**
- On failure → existing behavior (message flips to the error text); no success log.

## Data flow

```
run task in chat
  → store: mark running; steps = buildLog(task, type, dept)   (generated once, stored on message)
  → ResultCard streams <ExecLog steps> + "Ran N actions"
  → [server produces the real deliverable in parallel]
  → log finished AND result ready  → produced state (steps retained)
  → card shows "▸ What byte did · N steps" (collapsed) + preview + Approve / Read / Revise
  → founder Approves  → same toggle + preview + "Saved to your library"
  → toggle re-opens the same steps any time
  (produce failed → error text, no success log)
```

## Error handling / robustness

- **Produce fails:** the run→produced gate requires a successful result; on failure the message
  shows the error text (current behavior), the log stops, and no "produced"/success state is
  entered.
- **Reduced motion:** `ExecLog` skips the timed streaming and renders the completed log
  immediately, then the card settles to the produced (Approve/Read/Revise) state.
- **Missing steps** (an older persisted message from before this change, or a task the
  generator can't map): fall back to the current compact `"Producing…"` running state and a
  result with no "What byte did" toggle — the card must never crash on an absent `steps`.

## Testing

- **Unit (pure):** `buildLog` is already pure and testable; add coverage for the **"N steps"
  count label** derivation and any pure helper introduced for the toggle state.
- **Store:** a test that the run action attaches `steps` on start and retains them into the
  produced state, and that a failed produce leaves the message in the error state with no
  success log.
- **Manual on the Vercel PR preview** (not `next dev`): run a task from chat → watch the log
  stream with the actions counter → confirm it settles into the collapsed "What byte did · N
  steps" toggle **above** the preview + **Approve / Read / Revise** (still gated) → Approve →
  "Saved to your library" with the toggle still present → re-open the toggle → confirm the
  modal's execute log is unchanged (shared component) → toggle `prefers-reduced-motion` and
  confirm the log renders instantly → force a failure and confirm no false success.

## Ship

Built in an isolated worktree off `origin/main`; verify on the Vercel PR preview; PR → merge
so it reaches prod (committed ≠ merged ≠ deployed).
