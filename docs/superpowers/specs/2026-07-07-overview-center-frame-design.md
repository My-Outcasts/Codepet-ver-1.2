# Overview center legibility — auto-frame, beacon-card side-flip, hero milestone

**Date:** 2026-07-07
**Scope:** The Overview map's framing + beacon-card placement + the progress hero's
"next milestone" label. No change to the force sim / node layout (that's the deferred
layout-evenness pass), the rings/reveal, breadcrumb, or scaffold.
**Status:** Design approved (brainstorm), ready for implementation plan.

## Problem

Design review of the live Overview (dense 3D sphere, after the tame-3D revert #88, with
piece-1 rings + piece-3 reveal) surfaced three concrete issues:

1. **The beacon card covers the center.** `fitView` frames dead-center
   (`cameraPosition({x:0,y:0,z:dist}, {x:0,y:0,z:0})`, no bias) and the "BYTE · DO THIS
   NEXT" card is hard-pinned to the _right_ of its beacon node
   (`transform: translate(18px, -50%)`). When the beacon sits near the middle (its task's
   department is near the project center), the 250-px card lands on top of "Your company"
   and the center labels — the least-readable spot on the map.
2. **The hero's milestone contradicts the breadcrumb.** The progress hero shows
   "Next: {`nextStageOf(brief.stage)`}", built from the fine-grained onboarding stage list
   (`OB_STAGES`). That list runs out before the phase breadcrumb does, so the hero reads
   **"Final stage"** while the breadcrumb still shows **Run & grow** ahead — an apparent
   bug.

(The department-label-on-label overlap near the center — Design/Marketing/Your company
stacking — is a _layout_ problem, handled by the separate deferred "layout-evenness" pass,
not this spec.)

## Approach (chosen from brainstorm)

Three surgical, low-risk changes; no layout/force-sim touch.

### 1. Auto-frame bias (`fitView`)

Give the default framing a horizontal world-space bias so the project center sits
left-of-center and the right side (where the beacon card lives) has clear space:

```ts
const bx = DEPT_R * 0.35;
fg.cameraPosition({ x: bx, y: 0, z: dist }, { x: bx, y: 0, z: 0 }, 800);
```

This is the one proven piece of the reverted tame-3D worth keeping. It applies only to
`fitView` (the default/auto/recenter framing). `flyTo` / `portalSignal` moves are
**unbiased** — they intentionally frame a specific node.

### 2. Beacon card side-flip

The tethered card is hard-pinned to the node's right. Make it flip to whichever side has
room, so it never runs off the right edge or sits over the center:

- **`ByteGuide` gains a `flip?: boolean` prop.** When `flip`:
  - outer transform → `translate(calc(-100% - 18px), -50%)` (card to the **left** of the
    tether point) instead of `translate(18px, -50%)`;
  - the pointer arrow moves from the left edge to the **right** edge: `right: -5` (instead
    of `left: -5`) with the two shown borders swapped to `borderRight` + `borderTop`
    (instead of `borderLeft` + `borderBottom`) so it still points at the node.
- **The tether rAF loop computes the side** from the beacon's projected x:
  `flip = sc.x > dims.w * 0.62`. To avoid re-rendering `ByteGuide` every frame, hold the
  current side in a **ref** and only `setBeaconFlip(next)` when it actually changes
  (crosses the threshold). `ByteGuide` receives `flip={beaconFlip}`.
- Setting state inside the rAF callback (an event-like callback, not an effect body) does
  not trip the repo's `react-hooks/set-state-in-effect` rule.

Together with #1, the card sits in open space whether the beacon is left, right, or
near-center.

### 3. Hero milestone = next phase (matches the breadcrumb)

Add a pure helper to `lib/stages.ts`:

```ts
/** The roadmap phase after the founder's current one (matches the breadcrumb), or null
 *  when they're already in the last phase. */
export function nextPhaseName(stage?: string): string | null {
  const cur = currentPhaseName(stage);
  const i = PHASES.findIndex((p) => p.name === cur);
  return i >= 0 && i < PHASES.length - 1 ? PHASES[i + 1].name : null;
}
```

`OverviewView` uses `nextPhaseName(brief.stage)` for the hero's `nextStage` prop instead
of `nextStageOf(brief.stage)`. The hero component is unchanged — it already renders
`nextStage ? "Next: {nextStage} →" : "Final stage"`, so the fix is just feeding it the
phase-consistent value. `nextStageOf` stays everywhere else (AdvanceCard, breadcrumb
advance — those are genuine stage advances).

## Files

- **Modify** `lib/stages.ts` — add `nextPhaseName`.
- **Modify** `lib/stages.test.ts` — unit-test `nextPhaseName`.
- **Modify** `components/views/OverviewView.tsx` — `fitView` bias; `beaconFlip` state +
  ref + tether-loop compute; pass `flip` to `ByteGuide`; `ByteGuide` gains the `flip` prop
  (transform + arrow); hero `nextStage` uses `nextPhaseName`.

## Coexistence (unchanged, must keep working)

The force sim / node positions, rings + counts (piece 1), the parked treatment + unlock
reveal (piece 3), the breadcrumb, the first-run briefing/spotlight (`flyTo` stays
unbiased), the legend, and the example-plan banner are all untouched. The spotlight's
`flyTo(beaconId)` still frames the beacon directly (no bias). The bottom-left hero HUD is
unchanged except the value it shows for "next".

## Edge cases

- **No beacon** (no live next move) → no card, nothing to flip; `fitView` bias still
  applies.
- **Beacon exactly at the flip threshold** → the ref-guard prevents flicker (state only
  changes on a real crossing; a tiny hysteresis band is optional if flicker appears on the
  preview).
- **Reduced motion** → unaffected; `fitView`/`flyTo` durations are unchanged, the flip is a
  static position swap.
- **Last phase** (`nextPhaseName` → null) → hero shows "Final stage" — now _correctly_,
  only when the breadcrumb has no phase ahead either.
- **Narrow panel / chat open** → the bias is a fraction of `DEPT_R`, and the flip keys off
  the live `dims.w`, so both adapt to the current width.

## Testing

- **Unit (`lib/stages.test.ts`, node-env Vitest):** `nextPhaseName` returns the next
  `PHASES` name for a mid-journey stage (e.g. a Launch-phase stage → "Run & grow"),
  `null` for a last-phase stage, and stays consistent with `currentPhaseName`.
- **Manual (Vercel PR preview, prod build — not `next dev`):** the beacon card no longer
  covers "Your company" — it sits to the side with the project center visible; when the
  beacon is on the right half of the map the card flips to the left (arrow points right);
  the hero reads "Next: Run & grow →" (not "Final stage") when a phase is still ahead, and
  "Final stage" only on the last phase; the first-run spotlight still flies straight to the
  beacon (unbiased).

## Non-goals (YAGNI)

- No force-sim / node-layout change; no min-radius or spoke-length taming (that's the
  deferred layout-evenness pass, which addresses the Design/Marketing label overlap).
- No re-flatten of the map (the tame-3D lesson: flattening read worse).
- No change to the beacon content, rings, reveal, breadcrumb, or scaffold.
- No `flyTo`/portal bias.

## Dependencies & sequencing

Builds off `origin/main` (tip `0863e56`, includes pieces 1 & 3). Standalone PR touching
`lib/stages.{ts,test.ts}` + `components/views/OverviewView.tsx`. The deferred
layout-evenness pass (even spoke lengths / min-radius from center, to fix the
Design/Marketing label pile-up) is a separate later piece. Verify on the Vercel preview
(the 3D framing can't be judged under `next dev`); run `npm run format:check` before
pushing.
