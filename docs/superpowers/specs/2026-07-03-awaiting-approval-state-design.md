# Honest Task States — "Awaiting Approval" (Part 1) — Design

**Date:** 2026-07-03
**Status:** Approved design, pending implementation plan
**Branch:** `feat/awaiting-approval-state` (off `origin/main`)

## Problem

A task byte hasn't drafted yet is labeled **"Needs approval"** — on the Tasks board
(the `who === 'draft'` lane) and on the department detail (a "NEEDS YOUR APPROVAL"
tag), even though the only available action is **"Have byte draft it."** Those
contradict: nothing has been produced, so there is nothing to approve.

Root cause: task labels are keyed off `who` (the *workflow type* — draft / you /
does), not the task's *current state*. And there is **no persisted "drafted,
awaiting approval" state** — producing a draft persists nothing (only approval
writes to Firestore), so an un-approved draft is lost on reload and looks identical
to a never-touched task.

## Goal

Make the app honest about task state end-to-end:

1. A task byte hasn't produced reads as **"Up next"** (to be worked), not "needs approval."
2. When byte produces a draft, the task moves to a real **"Awaiting your approval"**
   state that **survives reload** — so you can leave and come back to review it.
3. Approving it (or, for ship-type tasks, shipping) moves it to **Done**.

**Success:** on the board and the department detail, "Have byte draft it" only ever
appears under "Up next," and "Approve / Revise" only under "Awaiting your approval."
Draft a task → reload → it's still awaiting your approval.

## Scope

This spec is **Part 1** only. Making the Overview's next-move beacon prominent (#3
from the audit) is an independent workstream with its own spec, built after this.

## Confirmed model (from the codebase)

- Tasks live **inline** in each department doc: `DepartmentDoc.tasks: Task[]`, stored
  at `companies/{companyId}/departments/{k}`. `loadCompanyData` reads them back with
  the department — so a flag stored *on the task* automatically rehydrates on reload.
- Firestore rules already allow a company member to write department docs
  (`match /companies/{companyId}/{sub}/{document=**}` → read/write for owner/member).
  **No rules change is needed.**
- `applyResult(task, type, res)` is where a produced deliverable lands on the task
  (sets `out` + rich payloads). Its callers are the run modal (`ArtifactModal`) and
  the inline-chat run/revise in the store (`runTaskInChat` / `reviseTaskInChat`).
- Approval already persists: `approveTask` sets `done`, writes the Library item, and
  calls `persistApproval`. Ship-type tasks (`run === 'route'`) are "Shipped" rather
  than "Approved".

## The state model

One new optional persisted marker on `Task` (in `lib/data.ts`):

```ts
/** Set true once byte has produced a reviewable draft the founder hasn't approved
 * yet. Persisted on the task so the "awaiting approval" state survives reload.
 * Moot once `done`. Never set for ship-type (route) tasks — those go straight to Done. */
drafted?: boolean;
```

Derived state (single helper, `taskState(t): 'up-next' | 'awaiting' | 'your-move' | 'done'`):

| Condition (first match wins) | State | Board lane | Label / action |
|---|---|---|---|
| `t.done` | done | **Done** | delivered (Shipped/Approved) |
| `t.drafted` | awaiting | **Awaiting your approval** | review the draft → Approve / Revise |
| `t.who === 'you'` | your-move | **Your move** | *Have byte do it* / you act |
| else (`who` is `draft` or `does`, `!drafted`) | up-next | **Up next** | *Have byte draft it* / *Have byte do it* |

Four lanes total — "byte handles" (`does`) is folded into **Up next** (byte's queue),
per the design call.

## Data flow

1. Founder triggers a draft ("Have byte draft it" → run modal, or inline chat run).
2. `applyResult` writes the deliverable onto the task **and sets `t.drafted = true`**
   (skip for ship/route tasks). The store then **persists the department's tasks**
   so the flag + draft survive reload.
3. Board + department detail re-derive state from the task → the task now shows under
   **Awaiting your approval** with the real draft and Approve / Revise.
4. Revise keeps it awaiting (regenerates the draft in place). Approve →
   `approveTask` sets `done` (existing path); `drafted` becomes moot.
5. On reload, `loadCompanyData` rehydrates the task with `drafted` + the draft intact.

## Components & changes

### `lib/data.ts`
- Add `drafted?: boolean` to `Task`.
- Add `taskState(t: Task)` helper (pure) returning the derived state above.

### `lib/firebase/companyData.ts`
- Add `persistDepartmentTasks(companyId, dept)` — writes the department doc's `tasks`
  (with the updated `drafted` flag + draft payloads) via the existing member-write
  permission. (Or reuse the existing department write path if one already fits.)

### `lib/store.tsx`
- In `runTaskInChat` and `reviseTaskInChat`, after `applyResult` succeeds: set
  `t.drafted = true` (unless ship/route), then call `persistDepartmentTasks`.
- The run-modal approval flow (`ArtifactModal` → its produce step) likewise sets
  `drafted` + persists when it produces a draft without immediate approval.
- No change to `approveTask` beyond it already flipping `done` (which supersedes `drafted`).

### `components/views/TasksView.tsx`
- Replace the four `who`-keyed columns with the four **state**-keyed lanes above,
  using `taskState`. Rename labels: "Needs approval" is gone; lanes are **Up next /
  Awaiting your approval / Your move / Done**.

### `components/views/DepartmentDetail.tsx`
- Derive each task card's status tag + primary button from `taskState`:
  - up-next → tag "Up next", button "Have byte draft it" / "Have byte do it".
  - awaiting → tag "Awaiting your approval", the draft preview + Approve / Revise.
  - done → existing delivered/shipped card.
- Removes the "NEEDS YOUR APPROVAL" + "Have byte draft it" contradiction.

## Error / edge behavior

- **Draft generation fails:** `drafted` is not set; the task stays **Up next** (no
  false "awaiting"). Matches today's failure handling.
- **Ship/route tasks:** never get `drafted`; they go **Up next → Done (Shipped)** as
  today.
- **Revise:** regenerates in place; task stays **Awaiting your approval**.
- **Persist write fails:** the in-memory draft still shows this session (optimistic);
  logs and, worst case, the draft is not there on next reload — same failure surface
  as the existing optimistic writes.
- **Legacy tasks** (drafted before this flag existed): `drafted` is undefined → they
  read as **Up next** until re-drafted. Acceptable; no migration needed.

## Testing

- **Unit:** `taskState(t)` across all four states incl. precedence (done > drafted >
  you > else); and that a ship/route task never resolves to `awaiting`.
- **Manual (localhost, signed in):** draft a `draft`-type task → it moves to
  **Awaiting your approval** with the real draft → **reload** → still awaiting (the
  B2 proof) → Approve → **Done**; confirm "Have byte draft it" never co-occurs with an
  "approval" tag anywhere.

## Out of scope (YAGNI)

- Overview next-move beacon (#3) — separate spec/plan, built next.
- Any change to how `does`/route tasks execute.
- Firestore rules changes (not needed).
- A separate "byte is doing" lane (folded into Up next).

## Risk

`lib/data.ts`, `lib/store.tsx`, and `lib/firebase/companyData.ts` are actively edited
by a concurrent session. All changes here are additive (a new optional field, a new
helper, a new persist function, label swaps). Work in an isolated worktree off
`origin/main` and merge carefully before the PR, as done for prior features.
