# Toolkit usage evidence — turning a toggle into receipts

**Date:** 2026-07-06
**Branch:** `feat/toolkit-usage-evidence` (off `origin/main`)
**Status:** approved design

## Problem

Turning on a skill / connecting a connector / enabling an agent in the Environment view is a
**pure in-app state flip** — the only feedback is a `Connected ✓` / `byte turned this on ✓`
label. There is no way to see that the item is actually _doing_ anything. A founder can't tell
a real, working capability from a cosmetic checkbox.

We keep the setup **manual and simulated** for now (no real OAuth, no live connections — per
the tester-guide scope). Within that honesty, the meaningful proof an item is "working" is
byte **using it in real work**: naming it while it runs, and accruing a visible track record.

## Direction (decided)

- **Evidence-through-use (Level 1).** Two surfaces, kept in sync:
  1. **In-run mention** — when byte runs a task, the execute log names the on-items that fit
     that task ("✓ Reviewed the diff with **Code review**").
  2. **Persistent receipt** — each Environment item shows _"Used in N tasks · last: '<task
     title>'."_
- **Fit-map (Option A), keyed on deliverable type.** Each item declares what work it fits; on a
  run we credit **only the on-items whose fit includes that task's deliverable type**. A
  marketing post never claims it used GitHub.
- **Receipt shows the last real task by name (Option C).**
- **Credited on _run_ (produce), not approve** — byte used it to do the work regardless of
  whether the founder keeps the draft; this keeps the receipt in sync with the in-run mention.
- **Deduped by task title** — "Used in N tasks" means N _distinct_ tasks.

## Non-goals

- **No real integrations / OAuth / live connections.** Execution stays simulated; this feature
  makes the _simulated_ work visible and honest, it does not make connections real.
- No usage analytics dashboard, no per-run history feed (Option D) — just the count + last task.
- Nothing in Giang's Build Coach surface. `lib/data.ts`, `lib/helpers.ts`,
  `components/views/EnvironmentView.tsx`, and the store's run/apply path are all ours.

## Global constraints

- **Honesty:** an item is only ever credited when it is **on** AND a task of a **fitting type**
  is run. Off items and non-fitting tasks never accrue credit. The receipt reflects real
  in-app run events — it must not imply a live external connection.
- **Reuse the existing run path.** The execute log comes from the existing `buildLog`; the run
  completion is the existing produce path — no parallel machinery.
- **Persist through the existing ENV channel** (`envStateFromCatalog` → Firestore), the same
  way `toggleEnv` already persists.

## Components

### 1. Data model (`lib/data.ts`)

`EnvItem` gains two optional fields:

- `fits?: string[]` — the deliverable types this item plausibly applies to (e.g. Code review
  `['build']`, GitHub `['build','site']`, Test Writer `['build']`, Notion
  `['post','dms','doc','prep']`, Web research broad). Seeded on the catalog items.
- `tasks?: string[]` — the distinct task titles this item has been used on (append-on-use,
  deduped, capped at the most recent ~20). Derives both the count and the last-task name.

### 2. Pure helpers — who gets credited (`lib/ai/toolkitUse.ts`, new — colocated with `envSetup.ts`)

- `toolkitUsedFor(env, type): string[]` — names of the items that are **on** (`s === 1`) AND
  whose `fits` includes `type`. Single source of truth for BOTH surfaces (so the log mention
  and the receipt always agree). Pure, unit-tested.
- `usageReceipt(item): string | null` — from `item.tasks`, returns `"Used in 3 tasks · last:
'…'"` (or `"Used in 1 task · last: '…'"`), or `null` when there are none. Pure, unit-tested.

### 3. Surface A — in-run mention (`buildLog`)

`buildLog(t, type, d, usedItems?: string[])` gains an optional `usedItems` param (names). When
present, it injects one check-style step per item into the execute log ("✓ Reviewed the diff
with **Code review**", "✓ Opened a PR on **GitHub**"). The wording is a small per-category
template (skill / connector / agent). Call sites (the deliverable modal today; the inline chat
run once PR #71 lands) pass `toolkitUsedFor(ENV, type)`. Absent the param, `buildLog` is
unchanged — backward compatible.

### 4. Surface B — the receipt (`EnvironmentView.tsx`)

Each rendered item (recommended cards + the browse-all rows) shows `usageReceipt(item)` when
non-null — a quiet line under the item, e.g. _"Used in 3 tasks · last: 'Draft the launch
narrative'."_ Unused items show nothing (optionally a subtle "Not used yet"). Reads live via
the existing `tick` re-render.

### 5. Credit on run (store action)

A new store action `creditToolkitUse(taskTitle, type)`:

- computes `toolkitUsedFor(ENV, type)`,
- for each such item, appends `taskTitle` to `item.tasks` **only if not already present**
  (dedupe), trimming to the last ~20,
- persists ENV via `envStateFromCatalog` (same channel as `toggleEnv`).

Called at the deliverable-produced point of **both** run paths (the inline `runTaskInChat`
after `applyResult`, and the department-panel/modal run after `applyResult`), so credit lands
whenever byte actually produces a deliverable — matching the moment the execute log named the
item.

## Data flow

```
founder turns items on (existing)
run a task (type ty)
  → call sites compute used = toolkitUsedFor(ENV, ty)   (on + fits ty)
  → buildLog(t, ty, d, used) injects "✓ … with <item>" steps  → founder SEES it used
  → deliverable produced (applyResult)
  → creditToolkitUse(taskTitle, ty): append taskTitle to each used item's `tasks` (deduped) → persist ENV
  → EnvironmentView renders usageReceipt(item): "Used in N tasks · last: '<title>'"
(off items / non-fitting tasks: never credited, never mentioned)
```

## Error handling / robustness

- **Empty result:** no on+fitting items → `buildLog` behaves exactly as today (no injected
  steps), `creditToolkitUse` is a no-op. The feature is invisible until an item is both on and
  used.
- **Item turned off after use:** its `tasks` history is retained (honest record of past use);
  it simply stops accruing new credit while off. The receipt still shows for off items that
  were used — that's truthful history, not a live-connection claim.
- **Persist failure:** handled like `toggleEnv`'s existing `persistEnv().catch` — the in-memory
  credit still shows this session; a failed write just doesn't survive reload.
- **Dedupe + cap:** re-running or revising the same task never inflates the count; `tasks` is
  capped so it can't grow unbounded.

## Testing

- **Unit (pure):** `toolkitUsedFor` (on+fits matching, off items excluded, non-fitting types
  excluded); `usageReceipt` (0 → null, 1 → "1 task", N → "N tasks" + last name);
  the dedupe/cap logic for appending a task title.
- **Manual on the Vercel PR preview** (not `next dev`): turn on Code review + GitHub → run a
  build-type task → the execute log names both → the Environment card shows _"Used in 1 task ·
  last: '<title>'"_ → run a second build task → count goes to 2, last updates → re-run the same
  task → count does NOT change → run a marketing post → GitHub is NOT credited.

## Ship

Built in an isolated worktree off `origin/main`; verify on the Vercel PR preview; PR → merge so
it reaches prod (committed ≠ merged ≠ deployed).
