# Overview grows & unlocks (living Overview — piece 3)

**Date:** 2026-07-07
**Scope:** The Overview only — make dormant branches read as "for later," and make the
map visibly reveal branches unlocking + new tasks appearing when a stage advance (or
manual re-plan) re-scaffolds the company. No change to the scaffold logic itself, the
breadcrumb, beacon, first-run briefing, legend, or persistence.
**Status:** Design approved (brainstorm), ready for implementation plan.

## Context: piece 3 of 4

The "living Overview" decomposes into: (1) progress dashboard ✅ (PR #94), (2) completes
& recedes, **(3) grows & unlocks ← this spec**, (4) momentum. This spec covers only
piece 3.

**Dependency:** piece 3 builds directly on piece 1 (the department ring + count in
`nodeThreeObject`, `GNode.done/total/pct`, `makeRingSprite`, `lib/overview/progress.ts`).
Implement it **off `main` after PR #94 merges** (or branch off the piece-1 branch) so it
builds on that code rather than conflicting with it.

## Problem

The company map already evolves — when the founder advances a stage (`advanceStage`) or
re-plans (`regenerateCompany`), `scaffoldCompany` → `applyScaffold` flips dormant
(`later: true`) departments to active with fresh tasks. But:

- The **map changes silently.** Only byte's **chat** narrates the re-plan ("…I've
  re-planned {company}… here's what's next"); nothing on the map signals which branch
  just unlocked or which tasks are new.
- **Dormant branches are indistinguishable from idle ones** — a `later` department renders
  as a dim `idle` node (alpha 0.5, 0 tasks), so a founder can't tell "parked, unlocks as
  you progress" from "active but not started."

Goal: make the map itself tell the growth story — show what's coming, and reveal it
arriving.

## Approach (chosen from brainstorm)

Two coordinated additions:

1. **Static "for later" treatment** — dormant (`later`) branches read as **hollow +
   dashed** ("outlined, not filled in yet"), distinct from active ringed branches.
2. **Unlock reveal** — on a re-scaffold that flips branches `later → active`, the map:
   eases the camera toward the newly-grown region, glows the unlocked branches for ~3s,
   and shows a transient **"✦ N areas unlocked"** pill, then settles into normal piece-1
   state (solid nodes with fresh `0/N` rings).

Rejected (from brainstorm): the lock-badge and ghosted parked looks (hollow+dashed
chosen); a persistent "new" pip (dropped — the glow + camera carry the moment); a byte
"what changed" narration card (the chat already narrates; keep the map signal minimal).

## Static: the "for later" branch treatment

In the node build + `nodeThreeObject`, branch on a new `GNode.later` flag (set from
`d.later`):

- **Node:** for `later` departments, replace piece-1's progress ring with a **dashed,
  hollow outline ring** (drawn by `makeRingSprite` in a new "parked" mode: a dashed stroke,
  no fill), and keep the node core faint (the existing `idle` alpha). No `done/total`
  count (there are no tasks yet); the label reads `"{name}"` with a muted **"for later"**
  subline (a second small sprite or a dimmer appended line).
- **Spoke:** the project→dept link for a `later` department renders **fainter** than an
  active spoke (lower opacity). (A truly dashed 3D line isn't cheap in this renderer;
  faint opacity + the dashed node outline together read as "parked" — verified on preview.)
- Active departments are unchanged (piece-1 filled ring + count).

`makeRingSprite` gains a `parked` option: `makeRingSprite(pct, colorHex, size, parked?)` —
when `parked`, it draws a single dashed outline circle (no track, no fill arc) in a muted
color instead of the track+arc.

## Dynamic: the unlock reveal

### Detecting the delta (store)

`scaffoldCompany` mutates the `DEPTS` singleton and resolves with `changed`. To know what
**unlocked**, snapshot the dormant set _before_ the call and diff _after_:

- In both `advanceStage` and `regenerateCompany`, before `scaffoldCompany(...)`:
  `const beforeLater = new Set(DEPTS.filter((d) => d.later).map((d) => d.k));`
- In the `.then((changed) => { if (changed) {...} })` success branch, compute the newly
  unlocked keys with a **pure helper** and publish a growth signal:
  `setGrowthSignal({ unlockedKeys: unlockedKeys(beforeLater, DEPTS), ts: Date.now() });`
- The store exposes `growthSignal: GrowthSignal | null` on `useApp()`. (`ts` makes each
  signal distinct so a repeat unlock of the same keys still fires.)

Pure, testable helper — `lib/overview/growth.ts`:

```ts
import type { Dept } from '../data';

export interface GrowthSignal {
  unlockedKeys: string[];
  ts: number;
}

// Departments that were dormant before the re-scaffold and are active after — i.e., the
// branches that just unlocked. Pure: takes the pre-scaffold dormant keys + the post
// state, returns the newly-active keys in DEPTS order.
export function unlockedKeys(beforeLater: Set<string>, deptsAfter: Dept[]): string[];
```

Behavior: `deptsAfter.filter((d) => beforeLater.has(d.k) && !d.later).map((d) => d.k)`.
Empty when nothing unlocked (e.g. a re-plan that only reshuffled tasks) — in which case
OverviewView shows no reveal.

### The reveal (OverviewView)

Watch `growthSignal` (by `ts`). On a new signal with a non-empty `unlockedKeys`:

- **Hold a `revealKeys` set** for ~3s (a `setTimeout` clears it; store the timeout in a
  ref and clear on unmount / on a newer signal). While held, the department nodes in
  `revealKeys` render a **bright glow halo** — a larger translucent colored sprite the
  existing `UnrealBloomPass` picks up — layered via `nodeThreeObject` (the `data` memo
  gains a reveal nonce so the glow is added/removed on state change). The nodes are already
  solid (post-scaffold `later` is false), so the parked→solid change plus the glow read as
  "it filled in and lit up."
- **Ease the camera** toward the newly-grown region: `flyTo` the first unlocked department
  node with a **gentle** duration (reuse the existing `flyTo(nodeId, ms)`), so attention is
  drawn there, then control returns (the existing interaction handlers already release the
  camera on user input).
- **Transient tag:** show a centered pill just under the breadcrumb — **"✦ N areas
  unlocked"** (N = `revealKeys.size`) — for the same ~3s window, then fade. A fixed
  position (not node-tethered) keeps it simple and robust.

**Reduced motion** (`prefers-reduced-motion`): skip the glow pulse and the camera ease;
still show the transient tag briefly and the settled solid nodes, so the founder sees
_that_ it grew without motion.

Everything settles into normal piece-1 rendering once `revealKeys` clears: the unlocked
departments are ordinary active branches with fresh `0/N` rings.

## Files

- **Create** `lib/overview/growth.ts` (+ `.test.ts`) — `GrowthSignal`, `unlockedKeys`.
- **Modify** `lib/store.tsx` — `growthSignal` state; compute in `advanceStage` +
  `regenerateCompany` (snapshot-before / diff-after); expose on the context value.
- **Modify** `components/views/OverviewView.tsx` — `GNode.later`; parked node/spoke
  treatment + `makeRingSprite` parked mode; the reveal (watch `growthSignal` → `revealKeys`
  - glow + `flyTo` + transient tag; reduced-motion path).

## Coexistence (unchanged, must keep working)

Piece 1's hero + rings, the breadcrumb, beacon, first-run briefing, legend, example-plan
banner, `openDept`, and the **scaffold logic** (`applyScaffold` — piece 3 only _reads_ its
before/after result, never changes how active/dormant is decided) are untouched. byte's
existing re-plan **chat** note is unchanged — the map reveal complements it. The existing
`advanceStage` overlay/roadmap move is preserved; the reveal rides on top of it.

## Edge cases

- **Nothing unlocked** (re-plan reshuffles tasks but no `later→active`) → `unlockedKeys`
  empty → no reveal, no tag. Rings/hero still update normally.
- **Scaffold fails** (`changed` falsy) → no growth signal (the store already rolls the
  stage back); no reveal.
- **Many unlocks at once** → glow all of them; camera eases to the first; tag reads the
  count.
- **Department already active before** → excluded (only `beforeLater` keys count), so a
  re-plan doesn't re-glow branches that were already active.
- **Reduced motion** → tag + settled state only (see above).
- **All departments active (late stages)** → future advances unlock nothing → no reveal;
  the map just re-plans tasks (rings update). Honest.
- **Reveal interrupted** (founder advances again within 3s) → the newer signal replaces
  `revealKeys` and resets the timer (ref-guarded).

## Testing

- **Unit (`lib/overview/growth.test.ts`, node-env Vitest):** `unlockedKeys` returns keys
  that were dormant-before and active-after, in DEPTS order; excludes keys active before;
  excludes keys still dormant after; empty when none changed; deterministic.
- **Manual (Vercel PR preview, prod build — not `next dev`):** dormant branches render
  hollow/dashed with "for later" and a fainter spoke; advancing a stage eases the camera to
  the newly-grown branches, glows them ~3s, shows "✦ N areas unlocked," then settles into
  solid nodes with fresh `0/N` rings; a re-plan that unlocks nothing shows no reveal;
  reduced-motion shows the tag + settled state without the glide; the reveal doesn't fight
  the existing advance overlay or the chat note.

## Non-goals (YAGNI)

- No "unlocks at {specific stage}" label — the scaffold doesn't record which future stage
  activates a department; "for later" is honest, a specific stage is not.
- No change to what the scaffold decides (active vs dormant); piece 3 only visualizes it.
- No persistent "new" pip; no byte narration card on the map (chat already narrates).
- No completes-&-recedes (piece 2) or momentum (piece 4).
- No true node "morph" tween (hollow→solid) or per-frame pulse if it proves costly — a
  hold-then-clear glow is sufficient; a subtle pulse is a nice-to-have, not required.

## Dependencies & sequencing

Builds on piece 1 (PR #94) — implement off `main` **after** #94 merges. Standalone PR
touching `lib/overview/growth.*`, `lib/store.tsx`, and `components/views/OverviewView.tsx`.
Piece 2 (completes & recedes) is independent and can come before or after. Work in an
isolated worktree; verify on the Vercel preview (the reveal + 3D can't be judged under
`next dev`); run `npm run format:check` before pushing.
