# Overview map — tame the 3D (flatten to a clean radial disc)

**Date:** 2026-07-06
**Scope:** The Overview map's layout + labels + framing only, inside the existing
`react-force-graph-3d` renderer. No renderer swap, no 2D rewrite, no view toggle,
no change to the ribbon, beacon/`ByteGuide`, first-run spotlight, legend, or
`openDept` panel.
**Status:** Design approved (brainstorm), ready for implementation plan.

## Problem

The Overview renders the company as a 3D force-directed graph, but departments are
seeded on a **full sphere** (golden-angle distribution) and then nudged by a force
sim. Projected to a 2D screen this reads as random scatter: nodes at arbitrary
angles and depths, crossing links, and — because several department nodes land
near the projected center — **their always-on labels collide** ("Design /
Marketing / Your company" pile up). The tethered beacon card (`ByteGuide`) can
also sit over the center, hiding the project node. The information is fine; the
composition is noisy.

Goal: keep the cinematic 3D but make it read as a **calm radial hub-and-spoke** —
roughly half the perceived clutter — with three surgical changes.

## Approach (chosen: "tame the current 3D")

Rejected alternatives (from brainstorm): a full 2D-radial renderer rewrite with
tasks-expanding-on-map and a 2D/3D toggle (B+C) — more legible still, but a large
rewrite of a 700-line 3D component and a second renderer to maintain. "Tame the
3D" gets most of the legibility win by changing only _where nodes sit_, _which
labels show_, and _how the camera frames_ — inside the renderer we already ship.

Three changes:

1. **Flatten the layout to an even-ring disc.**
2. **Task-label level-of-detail (reveal on zoom; hover already works).**
3. **Auto-frame so the project center is never occluded by the beacon card.**

## The three changes

### 1. Flatten to an even-ring disc

Today (in the `data` `useMemo` of `OverviewView.tsx`) departments are seeded on a
sphere:

```
yy = 1 - (di/(N-1))*2 ; rr = sqrt(1-yy²) ; th = GOLDEN*di
dx = cos(th)*rr*DEPT_R ; dy = yy*DEPT_R ; dz = sin(th)*rr*DEPT_R
```

and tasks likewise on a small sphere around each dept, after which a d3 force sim
refines them.

Replace with a **deterministic in-plane ring**, extracted to a pure module:

- **Departments** on an even ring in the x–y plane, evenly spaced by angle
  (`a = -π/2 + (di / N) * 2π`, starting at the top, clockwise):
  `x = cos(a)*DEPT_R`, `y = sin(a)*DEPT_R`, and a **compressed depth**
  `z = sin(GOLDEN*di) * DEPT_R * 0.25` — ~25% of the radius, enough to parallax
  gently on orbit, not a full sphere.
- **Tasks** in a small even ring in-plane around their department
  (`ta = (i / total) * 2π`): `x = dx + cos(ta)*TASK_R`, `y = dy + sin(ta)*TASK_R`,
  `z = dz + sin(GOLDEN*(i+1)) * TASK_R * 0.25`.
- **Pin the positions** so the force sim can't re-scatter them: set `fx/fy/fz` (the
  react-force-graph fixed-coordinate fields) to the computed values. This turns the
  layout deterministic and jitter-free; the existing `d3Force('charge'|'link')`
  tuning becomes inert and is removed. The "living" feel now comes entirely from
  the camera's gentle auto-rotate (unchanged), which the pinned disc parallaxes
  against.

Even angular spacing is what fixes the department-label collisions — no two
departments crowd the center anymore. Node **size and color are unchanged**
(`val` still encodes status: attention 7 / normal 5 / done 4; state colors, the
cyan beacon), so status information is preserved; only positions become orderly.

**Pure, testable unit — `lib/overview/layout.ts`:**

- `deptRingPosition(index: number, count: number): { x; y; z; fx; fy; fz }`
- `taskRingPosition(deptPos, index: number, total: number): { x; y; z; fx; fy; fz }`
  (pure functions of index/count and the `DEPT_R`/`TASK_R`/`DEPTH` constants, moved
  here). Node objects spread these in. `OverviewView`'s `data` `useMemo` becomes a
  thin consumer. This is the one part unit-testable under node-env Vitest (the stack
  has no React Testing Library); the rendering/camera are verified on the preview.

### 2. Task-label level-of-detail

Task labels already show **on hover only** (task nodes return `undefined` from
`nodeThreeObject` → default sphere; `nodeLabel` shows a tooltip on hover). Keep
that, and **also reveal task labels when the camera is zoomed in** past a distance
threshold:

- Track camera distance in the existing rAF/interaction loop; keep a `zoomedIn`
  boolean state (with hysteresis so it doesn't flicker at the threshold).
- When `zoomedIn` flips, call the graph's `refresh()` so `nodeThreeObject` re-runs;
  while `zoomedIn`, task nodes return a small `SpriteText` (same styling as dept
  labels, smaller `textHeight`) instead of `undefined`.
- Department and project labels remain always-on (they no longer collide after the
  flatten). The beacon's task keeps its `ByteGuide` callout regardless of zoom.

Graceful degradation: if the threshold logic is unavailable, hover still reveals
every task label, so nothing is lost.

### 3. Auto-frame (center never behind the beacon card)

The beacon card tethers to the beacon node (`graph2ScreenCoords` each frame,
rendered to the node's right). With the flatten, the beacon is a **ring** node
(off-center), so its card already sits in open space rather than over the project
center — this largely resolves itself. Add a modest guarantee:

- `fitView` frames the whole ring with **generous padding** and a slight
  **horizontal bias** (shift the framed composition a touch left) so the tethered
  beacon card on the right always has clear space and the project center stays
  visible. The bias is applied only to the default/auto fit, not to explicit
  `flyTo`/`portalSignal` moves (which intentionally frame a specific node).

## Coexistence (unchanged, must keep working)

The stage ribbon, `ByteGuide` beacon + its tether, the first-run spotlight
(`introPhase`, `flyTo(beaconId)`, vignette, reopen chip), the lit `pathLinkIds`
trail, the bottom legend, `mapDimmed`/`StageDrawer`, and `openDept` all read node
positions dynamically, so they keep working against the new coordinates. The
spotlight's `flyTo(beaconId)` now frames a ring node — same code, better shot.

## Edge cases

- **1 department** (`count === 1`): place it directly above the center (no
  divide-by-zero); ring math must handle small counts.
- **Department with 0 tasks:** no task nodes (unchanged); the dept still sits on
  the ring.
- **Many departments/tasks:** even spacing still holds (angles just get closer);
  the ring scales by count, not by hard-coded slots.
- **Reduced motion:** unaffected — auto-rotate is already gentle and the flatten
  adds no new animation; the spotlight's reduced-motion path is untouched.
- **Mobile-lite:** flattening + pinning removes the force sim's per-tick work and
  reduces overdraw — a perf neutral-to-win; keep existing mobile guardrails.

## Testing

- **Unit (`lib/overview/layout.ts`, node-env Vitest):** `deptRingPosition` spaces
  N departments at equal angles starting at the top, radius `DEPT_R`, and
  compresses z to ≤ ~25% of `DEPT_R`; `count === 1` returns the top position
  without NaN; `taskRingPosition` offsets tasks by `TASK_R` around the dept and
  never returns non-finite values; positions are deterministic (same input →
  same output) and set `fx/fy/fz` equal to `x/y/z`.
- **Manual (Vercel PR preview, prod build — not `next dev`):** departments sit on
  an even ring, no label pile-up at center; orbit shows gentle parallax (not a
  flat plane, not a sphere); hover a task → its label; zoom in → task labels
  appear, zoom out → they hide; the beacon card never covers the project center;
  the first-run spotlight still flies to and rings the beacon.

## Non-goals (YAGNI)

- No 2D renderer, no `react-force-graph-2d`, no SVG rewrite.
- No 2D/3D toggle, no tasks-expanding-on-map interaction.
- No change to node colors/sizes/status encoding, the ribbon, legend, beacon
  content, `openDept`, or any other view.
- No new persistence.

## Dependencies & sequencing

Builds off `origin/main` (which now includes the merged first-run spotlight,
`a4e9d07`) as a standalone PR touching only `lib/overview/layout.*` and
`components/views/OverviewView.tsx`. Given concurrent sessions on the local
checkout, do the work in an isolated git worktree; verify on the Vercel preview;
run `npm run format:check` before pushing (CI's `verify` runs `prettier --check .`
repo-wide — scoped local checks miss it).
