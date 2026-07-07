# Overview roadmap ribbon — lighten to a text-forward breadcrumb

**Date:** 2026-07-06
**Scope:** The Overview's stage ribbon only — `components/views/overview/StageRibbon.tsx`
plus one small pure helper and a couple of `app/globals.css` classes. No change to
the ribbon's data derivation (`lib/overview/ribbon.ts`), `PHASES`, the stage math
(`lib/stages.ts`), `StageDrawer`, or the map/graph.
**Status:** Design approved (brainstorm), ready for implementation plan.

## Problem

The Overview pins the five-phase journey (`Find → Build → Ship → Launch → Run & grow`)
to the top of the map as **five equal glass cards**, each carrying an ALL-CAPS kicker
(`DONE` / `YOU ARE HERE` / `AHEAD`), the phase name, a `%`, and a full-bleed progress
wash. That is a lot of visual weight for what is really an **orientation banner** — it
competes with the map instead of quietly framing it. Placement at the top is correct
(a top progress-stepper is the conventional, glanceable spot for "where am I in the
journey"); the issue is weight, not position.

Goal: keep the ribbon at the top and keep every behavior it has, but carry it with a
**light, text-forward breadcrumb** so the map dominates.

## Approach (chosen from brainstorm: option C, "text-forward breadcrumb")

Rejected lighter-but-still-boxed alternatives: "quiet segments" (five underline-only
segments) and "connected track" (one line threading five dots). The breadcrumb is the
minimum ink — phase names in a row, only the current phase given any chrome.

**Deliberate, accepted trade-off:** only the _current_ phase shows a progress bar. Done
and ahead phases are just their names (muted-green / faint). The five-equal-columns
metaphor and the per-phase progress washes are intentionally dropped — that is the
weight we are removing.

## The breadcrumb

Rendered left-aligned at the top of the map (a thin strip, not a full-width band), over
a subtle top scrim for legibility on bright map areas. Container keeps
`pointer-events: none` with interactive items `pointer-events: auto` (as today) so map
drag still works in the gaps between items. Items are `<button>`s (keeps keyboard focus,
hit area via padding, and the existing `title` tooltips).

Reading order: `Find › Build › Ship › [Launch pill] › Run & grow`, chevron `›`
separators in `rgba(255,255,255,.16)`.

### Per-phase visual states (drives off `RibbonSegment.state`)

- **done** — phase name, muted green `rgba(52,211,153,.72)`, weight 600, clickable.
- **future ("ahead")** — phase name, faint `rgba(245,243,255,.32)`, clickable.
- **current** — a pill: `background rgba(139,92,246,.16)`, `border 1px rgba(139,92,246,.4)`,
  radius 999, containing the phase name (`#F5F3FF`, weight 700), a small 34×4 progress
  sliver (track `rgba(255,255,255,.14)`, fill `#C9B8FF` to `pct%`), and the `pct%` in
  `#C9B8FF`. `pct` comes from `currentStageProgress().pct` (unchanged source).
- **current + stage complete** — when `stageComplete()` is true for the current phase, the
  pill instead reads **"Advance to {nextStage} →"** on a lit gradient
  (`linear-gradient(90deg, rgba(139,92,246,.28), rgba(52,211,153,.22))`,
  border `rgba(139,92,246,.55)`, soft glow `0 0 16px rgba(139,92,246,.25)`), and its
  click calls `advanceStage` instead of `selectStage`. `nextStage` comes from
  `nextStageOf(brief.stage)` (unchanged).

### Interactions (unchanged behaviors, new skin)

- Click a **done/future** phase or the **current pill** (not-complete state) →
  `selectStage(seg.stageN)` → opens that phase's `StageDrawer` checklist. Exactly as today.
- Click the **current pill** in the complete state → `advanceStage`. Exactly as today.
- Re-render on company mutation via the existing `tick` read.

The exact hexes above are reused verbatim from the current `StageRibbon`
(`#34D399`, `#8B5CF6`, `#C9B8FF`, `#F5F3FF`) so the ribbon stays on-palette. Any of the
current module constants (`CARD_BG`, `BORDER`) left unused after the rewrite must be
removed so `eslint .` stays clean (no `no-unused-vars`).

## Responsive (narrow window / mobile)

A single-line breadcrumb of five names + separators can overflow a narrow map column.
Below a width breakpoint the breadcrumb **collapses completed and ahead phases into
counts**, keeping the current phase always fully readable:

`3 done › [Launch 44%] › 1 ahead`

- The current phase's pill is unchanged (name + %, or the Advance state).
- Leading done phases collapse to a single **"N done"** button; clicking it opens the
  **first** of those done phases (`selectStage` of the earliest done phase's `stageN`).
- Trailing ahead phases collapse to a single **"N ahead"** button; clicking it opens the
  **first** ahead phase's `stageN`.
- If there are zero done (current is first) → no "N done" chip; if zero ahead (current is
  last) → no "N ahead" chip. If the journey is fully complete (no current phase) → show
  "N done" only (no pill).

**Mechanism (no new hooks — lowest React-Compiler-lint risk):** the component renders
**both** a `.stage-ribbon-full` and a `.stage-ribbon-compact` sibling; `app/globals.css`
shows the full one and hides the compact one by default, and swaps them at
`@media (max-width: 640px)`. This mirrors the app's existing viewport-breakpoint
"mobile-lite" convention rather than adding a `ResizeObserver`/`matchMedia` hook to a
component the React-Compiler ESLint plugin watches. Keying off the viewport (not the
element) can collapse slightly earlier than strictly necessary when the sidebar is
collapsed (more room) — an acceptable, conservative trade.

## Pure, testable unit — `lib/overview/ribbonCompact.ts`

The grouping logic is pure and node-env-Vitest-testable (the stack has no React Testing
Library); the rendering is verified on the Vercel preview.

```ts
import type { RibbonSegment } from './ribbon';

export interface CompactGroup {
  count: number;
  /** stage to open when the group chip is clicked: the group's first phase. */
  stageN: number;
}
export interface CompactRibbon {
  leadDone: CompactGroup | null; // done phases before the current one
  current: RibbonSegment | null; // the single 'current' phase, if any
  trailAhead: CompactGroup | null; // future phases after the current one
}

export function compactRibbon(segs: RibbonSegment[]): CompactRibbon;
```

Behavior: find the single `current` segment (`state === 'current'`). Everything before it
is `leadDone` (count = that many, `stageN` = the first of them); everything after is
`trailAhead` (count = that many, `stageN` = the first of them). Zero-length groups → `null`.
If there is no `current` segment (all done), `current` is `null`, `leadDone` covers all
done phases, `trailAhead` is `null`. `ribbonSegments()` already emits phases in journey
order with exactly one `current` (done before, future after), so the split is a clean
partition; the helper does not assume contiguity beyond "first current index".

`lib/overview/ribbon.ts` (`ribbonSegments`, `RibbonSegment`) is unchanged and still the
source the full breadcrumb maps over.

## Coexistence (unchanged, must keep working)

The first-run spotlight, the `ByteGuide` beacon + tether, the lit `pathLinkIds` trail,
the bottom legend, `openDept`, and the map graph are untouched. The ribbon is now a thin
strip rather than a tall band, so it **occludes less** of the map — strictly better for
the spotlight/beacon composition. The `StageDrawer` opened by `selectStage` is unchanged.

## Edge cases

- **Current phase is first** (`Find` is current) → no "N done" chip; breadcrumb starts
  with the pill.
- **Current phase is last** (`Run & grow` is current) → no "N ahead" chip.
- **Journey complete** (no `current`) → "N done" only, no pill; nothing to advance.
- **Stage complete but no next stage** (`nextStageOf` returns `null`) → keep the normal
  current pill (name + `100%`), do not show an "Advance to null" affordance.
- **Reduced motion** → the pill's progress-sliver fill and the advance glow use only
  simple width/opacity; no new motion introduced. Existing reduced-motion paths untouched.

## Testing

- **Unit (`lib/overview/ribbonCompact.test.ts`, node-env Vitest):**
  - Mid-journey (`done,done,done,current,future`) → `leadDone {count:3, stageN: firstDone}`,
    `current` = the current seg, `trailAhead {count:1, stageN: theAheadSeg}`.
  - Current first (`current,future,future,…`) → `leadDone: null`, `trailAhead.count` = rest.
  - Current last (`done,…,current`) → `trailAhead: null`, `leadDone.count` = the dones.
  - All done (`done,done,done`) → `current: null`, `leadDone.count: 3`, `trailAhead: null`.
  - `stageN` of each group equals the first constituent phase's `stageN`.
  - Deterministic (same input → same output).
- **Manual (Vercel PR preview, prod build — not `next dev`):** the top of the map now
  shows the light breadcrumb; done phases muted-green, current in a pill with a small
  progress sliver + %, ahead faint; hover/click any phase opens its checklist; when the
  current stage is complete the pill becomes "Advance to {next} →" and advances; shrink
  the window → done/ahead collapse to "N done"/"N ahead" with no horizontal overflow and
  the current pill stays readable; the ribbon no longer covers the project center; the
  first-run spotlight still flies to and rings the beacon.

## Non-goals (YAGNI)

- No change to the ribbon's placement (stays pinned top-left of the map).
- No per-phase progress bars for done/ahead phases (deliberately dropped).
- No change to `ribbon.ts` derivation, `PHASES`, `lib/stages.ts` math, `StageDrawer`,
  the legend, `openDept`, or the map/graph.
- No `ResizeObserver`/`matchMedia` hook (CSS breakpoint instead).
- No new persistence, no new dependencies.

## Dependencies & sequencing

Builds off `origin/main` (tip `2925ae2`, which restored the old 3D sphere map after the
tame-3d revert #88) as a standalone PR touching only `StageRibbon.tsx`,
`lib/overview/ribbonCompact.*`, and a small `app/globals.css` addition. Given concurrent
sessions on the local checkout, do the work in an isolated git worktree; verify on the
Vercel preview; run `npm run format:check` before pushing (CI's `verify` runs
`prettier --check .` repo-wide — scoped local checks miss the docs).
