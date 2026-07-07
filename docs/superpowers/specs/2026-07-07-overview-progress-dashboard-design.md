# Overview progress dashboard (living Overview — piece 1)

**Date:** 2026-07-07
**Scope:** The Overview only — add an overall progress hero (top-left HUD) and a
per-department progress ring + count on the map nodes. Surfaces already-computed
progress. No change to the breadcrumb, beacon, first-run briefing, legend, example-plan
banner, or the graph layout/scaffold.
**Status:** Design approved (brainstorm), ready for implementation plan.

## Context: this is piece 1 of 4

The founder wants the Overview to be a **living progress model**, not a static map + a
stage bar. That decomposes into four independently-shippable pieces:

1. **Progress dashboard** — overall "how far along" + per-department progress on the map. ← **this spec**
2. Completes & recedes — finished departments visibly settle/recede.
3. Grows & unlocks — dormant departments unlock, new tasks appear.
4. Momentum — recency/velocity ("N moves this week"), nodes pulse on completion.

Each is its own spec → plan → build. This spec covers **only piece 1.**

## Problem

Today the Overview's only glanceable progress is the breadcrumb's current-phase `%`.
Per-department progress (`done/total`) is computed but only shows **on hover**;
`productProgress()`/`companyProgress()` in `lib/stages.ts` are computed but rendered
**nowhere**. A founder can't see, at a glance: how far along the whole build is, or which
areas are done vs. barely started.

## Approach (chosen from brainstorm)

Two glanceable, self-contained additions that surface data we already have:

1. **Overall hero — top-left HUD.** A small persistent card under the breadcrumb: a
   completion **rollup** + the **next milestone**.
2. **Per-department ring + count.** Each department node gets a thin progress arc (fills
   with `done/total`, full green when complete) **plus the exact count** under its label,
   always visible (not just on hover).

Rejected (from brainstorm): a Product-vs-Company split (dropped by the founder); a slim
breadcrumb-band bar and a bottom-left placement (top-left HUD chosen); label-only or
node-fill-only per-department treatments (ring + count chosen for precision).

## The overall hero (top-left HUD)

A presentational card floated at the map's top-left, below the breadcrumb strip:

```
◉ BUILDING YOUR COMPANY
▓▓▓▓▓▓▓░░░  62%
18/29 moves · 4 of 8 areas done
Next: {next stage} →
```

- **`%`** = the whole active-plan completion: all tasks in **non-dormant** departments,
  `done/total`. This is deliberately the **same measure the breadcrumb pill shows** (kept
  consistent), but here it's prominent and carries context the pill can't.
- **moves** = `done`/`total` task counts across active departments.
- **areas done** = count of active departments that are 100% complete / count of active
  departments.
- **Next milestone** = `nextStageOf(brief.stage)` (the next stage after the current one,
  the same source the breadcrumb's "Advance to {nextStage}" uses) rendered as
  "Next: {nextStage} →"; if there's no next stage (final stage), show "Final stage"
  instead of a dead arrow.
- Uses the existing `tick` read so it stays live as tasks complete (same pattern as
  `StageRibbon`). Absolute-positioned, `pointer-events: none` on the wrapper (it's
  informational; no click target in piece 1).

Placement clears the breadcrumb (top strip) and the beacon card (tethers center-right)
and the "? how to read this map" chip (bottom). The first-run briefing modal covers the
map; the hero shows on the **live** map after the intro is dismissed.

## Per-department ring + count

Inside the existing `react-force-graph-3d` renderer, extend `nodeThreeObject` for
**department** nodes (task/project nodes unchanged):

- Today it returns a single `SpriteText` label lifted above the node. Change it to return
  a `THREE.Group` containing **(a)** that label — with the **count appended**
  (`"{name}   {done}/{total}"`, or `"{name} ✓"` when complete) — and **(b)** a **ring
  sprite**.
- The ring is a `THREE.Sprite` with a `CanvasTexture`: a full faint **track** circle plus
  an **arc** filled clockwise from the top to `pct`, sized to encircle the node
  (radius ≈ the node's projected radius + a small gap). Because sprites **billboard**
  (always face the camera), the ring reads as a clean circle at any orbit angle — no
  fragile per-frame screen-space projection, no desync.
- **Arc color:** the department's identity color (`deptColor`) while in progress; **green
  `#34D399`** at 100%. Track: `rgba(255,255,255,0.14)`. A 0% department shows just the
  faint track (honest "not started").
- The department `GNode` gains `done`, `total`, `pct` (from the pure `deptProgress`
  helper below) so `nodeThreeObject` can draw the arc without recomputing.

The existing done-department styling (`allDone` → dimmer color + smaller `val`) is
**unchanged** — the ring adds precision on top; the visual "recede" of finished areas is
piece 2, out of scope here.

## Pure, testable units — `lib/overview/progress.ts`

Extracted so the math is node-env-Vitest-testable (the stack has no React Testing
Library); the HUD component and the ring canvas are verified on the preview.

```ts
import type { Dept } from '../data';

export interface Progress {
  done: number;
  total: number;
  pct: number;
}

// One department's task completion. Reused by the node build AND overviewProgress, so
// the ring and the hero can never disagree.
export function deptProgress(dept: Dept): Progress;

export interface OverviewProgress extends Progress {
  /** Active (non-dormant) departments that are 100% complete. */
  areasDone: number;
  /** Total active (non-dormant) departments. */
  areasTotal: number;
}

// Whole active-plan rollup for the hero. Excludes dormant (`later`) departments — the
// same universe stageComplete()/currentStageProgress() measure.
export function overviewProgress(depts: Dept[]): OverviewProgress;
```

Behavior:

- `deptProgress`: `done` = tasks with `t.done`, `total` = task count, `pct` =
  `total === 0 ? 0 : Math.round(done/total*100)`.
- `overviewProgress`: sum `done`/`total` over departments where **not** `d.later`;
  `pct` guards the 100%-iff-complete invariant like `currentStageProgress`
  (`done === total ? 100 : Math.min(99, Math.round(...))`), so it never reads 100% with a
  task still open; `areasTotal` = active departments; `areasDone` = active departments
  whose `deptProgress().pct === 100` (equivalently `done === total && total > 0`).

`OverviewView` calls `overviewProgress(DEPTS)` + `nextStageOf(brief.stage)` for the hero,
and `deptProgress(d)` in the node build for each department's `pct`.

## Files

- **Create** `lib/overview/progress.ts` (+ `.test.ts`) — `deptProgress`, `overviewProgress`.
- **Create** `components/views/overview/OverviewProgressHud.tsx` — the presentational hero.
- **Modify** `components/views/OverviewView.tsx` — render the HUD (compute from
  `overviewProgress` + `nextStageOf`); add `done/total/pct` to department `GNode`s; extend
  `nodeThreeObject` to return the label-with-count + ring sprite for department nodes.

## Coexistence (unchanged, must keep working)

Breadcrumb (`StageRibbon`), `ByteGuide` beacon + tether, the first-run project briefing
(`OverviewIntro` + spotlight), bottom legend + reopen chip, the example-plan banner
(`examplePlanBanner`), `openDept`, and the map layout/scaffold are untouched. The hero's
`%` intentionally matches the breadcrumb pill's number (consistency, not conflict).

## Edge cases

- **Department with 0 tasks** → `deptProgress` pct 0, `total` 0; not counted as an "area
  done" (`total > 0` required); ring shows the empty track.
- **No active departments** (all dormant / none) → `overviewProgress` returns
  `{done:0,total:0,pct:0,areasDone:0,areasTotal:0}`; hero shows "0% · 0/0 moves" gracefully
  (no divide-by-zero).
- **Final stage** (`nextStageOf` → null) → hero shows "Final stage", no dead arrow.
- **All complete** (`done === total`) → hero `100%`; every active department a full green
  ring.
- **Reduced motion** → the ring/hero add no animation in piece 1 (fills are static reads);
  nothing to gate.
- **Bloom over the ring** → the ring sprite is drawn with a solid track so it stays legible
  over the bloomed node core, same concern the label pill already solves.

## Testing

- **Unit (`lib/overview/progress.test.ts`, node-env Vitest):** `deptProgress` (done/total,
  pct rounding, 0-task → 0); `overviewProgress` (excludes `later` depts; sums active;
  `areasDone` counts only 100%-complete non-empty departments; the 100%-iff-complete guard
  — 3/4 tasks over many never rounds to 100; all-dormant → zeros).
- **Manual (Vercel PR preview, prod build — not `next dev`, per the standing first-run
  rule):** the top-left hero shows the rollup + next milestone and updates live when a task
  is approved; each department node shows a ring filling to its `done/total` with the count
  under the label; a complete department is a full green ring + "✓"; orbiting keeps the
  rings circular (billboarded); the hero doesn't collide with the breadcrumb, beacon, or
  legend.

## Non-goals (YAGNI)

- No completes-&-recedes, grows-&-unlocks, or momentum (pieces 2–4).
- No ring on the center/project node (overall lives in the hero); possible later touch.
- No Product-vs-Company split; no click target on the hero.
- No change to node colors/sizes/status, the scaffold, or persistence.

## Dependencies & sequencing

Builds off `origin/main` (tip `8dc2a0e`) as a standalone PR touching only
`lib/overview/progress.*`, `components/views/overview/OverviewProgressHud.tsx`, and
`components/views/OverviewView.tsx`. Piece 2 (completes & recedes) builds directly on
`deptProgress`. Given concurrent sessions, work in an isolated worktree; verify on the
Vercel preview; run `npm run format:check` before pushing (CI runs `prettier --check .`
repo-wide).
