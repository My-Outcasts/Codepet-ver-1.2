# Unified Overview — Design

**Date:** 2026-07-06
**Status:** Approved design, pending implementation plan
**Branch:** `feat/unified-overview` (off `origin/main`)

## Problem

Codepet has two screens that each tell half the story:

- **Overview** — a 3D force-directed map (project → 8 departments → tasks),
  color-coded by task state, with a pulsing beacon on the next task, a
  "Next step" card, and a Progress card that _links out_ to the Roadmap. It
  shows **structure** (who does what) but narrates almost nothing about
  **journey** (where you are in time, how far you've come).
- **Roadmap** — a flat 2D ladder of 5 phases → stages with dependency edges,
  `done/now/next/locked` states, and a `StageDrawer` (per-stage _why_,
  checklist, and the advance-stage / next-move prompt). It carries the whole
  journey but on a separate screen the founder has to navigate to.

Three founder questions go unanswered on the Overview today: (1) how do I see
progress in the graph, (2) how does Codepet show where I am and what's next,
(3) can I look at the Overview and understand what to do.

## Goal

Make the **Overview the single home** that also does the Roadmap's job:
narrate _where you are_, _how far you've come_, and _the one thing to do
next_ — legibly, on the map. **Retire the Roadmap tab.**

**No new feature surface, no new systems.** This is a re-composition of parts
that already exist (`PHASES`, `eff()`, `stageWatermark()`, the `StageDrawer`,
`advanceStage`, the beacon/`nextStep` spine) onto one screen, plus a slim new
ribbon component and a deeper map dim treatment.

## Confirmed decisions (from brainstorming)

- **Scope:** retire the separate Roadmap tab; Overview is the one home.
- **Progress model:** _both_ — a slim always-visible **stage ribbon HUD**
  _and_ a **map that reacts** to the current stage.
- **Ribbon granularity:** **5 phases** (Find → Build → … → Grow) as the
  segments — not the finer 6 stages.
- **Meters:** **drop** the twin Product/Company meters; the ribbon's
  stage-progress fill is the single "how far" read.

## The design

### Reading order (the core fix)

The founder's eye reads three things, top to bottom, each answering one
concern:

1. **Ribbon (top)** → _where am I_ — "You're in **Build**, 60% through this
   stage."
2. **Next-step card (top-left)** → _what do I do_ — the one task + **Start**.
3. **The map (fills the screen)** → _how it connects and how alive it is_ —
   lit = active now, dim = done, faint = later.

### Component 1 — Stage ribbon (`components/views/overview/StageRibbon.tsx`)

A slim horizontal bar pinned along the **top** of the map.

- **Segments:** the 5 `PHASES` left→right. Each segment shows the phase name.
- **State per segment**, derived from the phase's stages via `eff()`:
  - all stages `done` → **done** (filled).
  - any stage `now` → **current** ("you are here"), with a **fill** showing %
    through the current stage (from `stageProgress()` / the current node's
    task completion).
  - otherwise → **future** (faint) or **locked**.
- **Interaction:** click a segment → `selectStage(n)` on that phase's current
  (or first) stage, which opens the `StageDrawer` (Component 3).
- **Data source:** `PHASES`, `byN`, `eff`, `stageWatermark`, `stageProgress`
  — the exact inputs the Roadmap uses, so the ribbon and the (removed) Roadmap
  can never disagree.
- **Display-only styling** consistent with the existing glass HUD cards
  (`rgba(16,14,28,.72)`, blur, 1px hairline border), minimalist, no
  decorative icons.

### Component 2 — Reactive map (edit `OverviewView.tsx`)

The graph reacts to the **current stage** by default, with an honest boundary
for other stages:

- **Current stage (default):** spotlight **open work** (bright, as today) and
  let **done work recede** more decisively than today — lower alpha and
  smaller `val` for `done` tasks and for departments whose work is fully done
  — so "how much is alive" reads as progress at a glance. This deepens the
  existing task-state coloring; it does not add a new data axis.
- **A past/future stage clicked on the ribbon:** the map does **not**
  fabricate nodes for it (per-stage dept-tasks don't persist as graph nodes —
  tasks are scaffolded for the current stage only). Instead the map gently
  **dims to background** while the `StageDrawer` carries that stage's authored
  checklist. Closing the drawer restores the live current-stage map.
- **Boundary, stated plainly:** the ribbon + drawer own the _journey
  timeline_; the map owns the _live company_. The map only ever reflects real
  live tasks, never reconstructed history.

### Component 3 — StageDrawer, lifted (`components/views/overview/StageDrawer.tsx`)

Move the `StageDrawer` out of `RoadmapView.tsx` into a shared component under
`components/views/overview/` and render it from `OverviewView`. **Behavior
unchanged** — same _why_, authored **checklist**, and the advance-stage /
byte's-next-move prompt, driven by `selStage` / `drawerOpen` / `closeStage` /
`advanceStage` / `portalToTask` from the store. It slides in over the map when
a ribbon segment is clicked.

### Component 4 — Next-step anchor (keep as-is)

The pulsing **beacon**, the **"Next step"** `HereCard`, and **Start** (fly to
dept → `briefDepartment` opens byte in chat) stay exactly as they are — this
is already the single clearest "do this next." It becomes the visual anchor
directly under the ribbon. No change to the `nextStep` spine.

### Component 5 — Advance-stage (no dead-end)

When every current-stage task is done (`stageComplete()`):

- the ribbon's current segment flips to **"Stage complete — Advance to
  [next]"**, and
- the `HereCard` swaps its task line for the same **Advance** prompt
  (`advanceStage()`), matching the Roadmap's existing `readyToAdvance`
  behavior.

### HUD consolidation (minimalist)

Remove the Progress card (its Product/Company meters are dropped and its "open
the roadmap" link is now pointless). Net HUD after this change:

- **Ribbon** (top, full width, slim)
- **Next-step card** (top-left, under the ribbon)
- **Legend** (bottom-left, unchanged)

Fewer floating cards than today.

### Navigation / retirement

- Remove the **Roadmap** entry from the app nav (sidebar/topbar).
- Reroute any `show('roadmap')` caller (e.g. the old Progress card's `onOpen`,
  and any Roadmap deep-links) to `show('overview')` + `selectStage(...)` so the
  drawer opens on the Overview instead.
- `RoadmapView.tsx` is deleted **only after** its `StageDrawer` is lifted and
  every reference is rerouted; the `RoadmapView` route is removed from the
  view switch.

## Data flow (all pre-existing)

- Ribbon ← `PHASES` / `byN` / `eff` / `stageWatermark` / `stageProgress`
  (read-only).
- Ribbon click → `selectStage(n)` → store sets `selStage` + `drawerOpen` →
  `StageDrawer` renders.
- Map ← `DEPTS` + live `tasks` + `taskState` (as today), with a deeper
  `done`-recede treatment; dims to background while `drawerOpen` and the
  selected stage ≠ the current stage.
- Beacon / HereCard ← `nextStep` (+ `nextAction()` fallback), unchanged.
- Advance ← `stageComplete()` / `nextStageOf()` / `advanceStage()`, unchanged.

## Testing

- **Ribbon unit tests (pure):** segment state derivation from `PHASES` +
  `eff()` — a fully-done phase reads `done`; the phase containing a `now`
  stage reads `current`; later phases read `future`/`locked`; the current
  segment's fill % matches `stageProgress()` for the current stage. Exactly
  one segment is ever `current`.
- **Advance state:** when `stageComplete()` is true, the current segment and
  the HereCard both surface the Advance affordance (component test on the
  derived flags, not the 3D canvas).
- **Retirement:** no remaining `show('roadmap')` references; the view switch
  no longer includes a Roadmap case; nav has no Roadmap entry (grep-level
  assertions in a test or a lint check).
- **Manual (Vercel preview):** the Overview reads top→bottom as ribbon →
  next-step → map; clicking a phase opens its checklist drawer; done work
  visibly recedes; completing a stage's tasks surfaces Advance. (The 3D
  canvas itself is not unit-testable — verified on the prod build preview,
  per the standing "verify on preview" practice.)

## Scope, risk, out-of-scope

- **In scope:** `StageRibbon` component; lift `StageDrawer` into a shared
  Overview component; deeper done-work recede + drawer-dim in `OverviewView`;
  HereCard advance state; retire the Roadmap tab/route/nav and reroute
  callers; tests.
- **Out of scope (YAGNI):** reconstructing past/future stages' dept-tasks as
  graph nodes; any change to the `nextStep` brain, scaffold, or run-task; new
  progress metrics; animating the map between stages beyond a dim/restore.
- **Not Giang's:** Overview, Roadmap, stage helpers, and the store are core
  app, not the Build Coach (`/api/track*`, `/api/build-plan`, BuildCoach/
  Install/Summary views, toolkit/hooks) — in bounds.
- **Risk — concurrent session:** the local checkout is driven by another
  session that flips branches and edits store/views. Work stays in the
  isolated worktree off `origin/main`; verify on the Vercel preview (symlinked
  node_modules runs checks but breaks `next dev`). Merge `origin/main` before
  the PR if it has moved.
