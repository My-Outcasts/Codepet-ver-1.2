# Overview first-run redesign — Spotlight handoff

**Date:** 2026-07-06
**Scope:** Overview arrival only. The onboarding form, scaffold, run-loop, and every other view are untouched.
**Status:** Design approved (brainstorm), ready for implementation plan.

## Problem

A first-time founder lands on the Overview map and meets `OverviewIntro` —
a one-shot modal that teaches how to *read* the map (journey ribbon, lit next
move, a 4-color legend) before they know *why* they'd want to. Two concrete
faults:

1. **It front-loads mechanics before value.** ~110 words, a full 4-color legend
   memorized against nodes dimmed behind the overlay. The payoff — seeing byte
   produce something — is delayed behind a lesson.
2. **Its CTA is a dead end.** "Show me my next move" is a no-op: it only calls
   `setShow(false)` to dismiss the overlay. It does not fly to, spotlight, or
   start the next move. The one promise the button makes, it doesn't keep.

Goal: lead with the next move, hand off to it for real, and teach the map
contextually — supporting the product's own "first value < 2 min" target.

## Approach (chosen)

**Spotlight handoff.** Slim the intro to a value-first card, and make its CTA
physically glide the camera to the already-existing beacon, dim the rest, and
spotlight the beacon card that is *already on screen* — teaching only the one
color that matters, right then. Rejected alternatives: a multi-step modal tour
(still makes them read before acting) and a fully ambient non-modal nudge (loses
the deliberate "here is the one thing" framing on first arrival).

Reuse over rebuild: the handoff targets the **existing** `HereCard` beacon and
the **existing** `flyTo()` camera glide. No second "next move" card is created.

## The two-frame flow

**Frame 1 — Slim intro (`OverviewIntro`, rewritten).**
- Eyebrow `byte · your companion`; title *"I'll build your company with you —
  one move at a time."*; one body line establishing the map = your company and
  the single rule (*"I always keep one move lit"*). No 4-color legend.
- One primary CTA: **Show me my next move ▸**, plus a muted reassurance line
  *"I'll explain the map as we go."*
- Target ~60 words (down from ~110).

**Frame 2 — Spotlight handoff (triggered by the CTA).**
1. Camera glides to the beacon node (`flyTo`).
2. The rest of the map dims; the lit beacon + its trail stay bright.
3. The existing `HereCard` ("byte · do this next") gets a one-time glow ring.
4. A single contextual color chip is shown next to the beacon, naming **only
   that task's state color** (e.g. *"Gold = I draft it, you approve"*).
5. A persistent **"? how to read this map"** chip lets the user re-open the full
   intro + the complete color key at any time.

From here the user hits the beacon's existing **Start** and enters the normal
run loop — unchanged.

## Architecture & components

The intro currently self-manages its lifecycle and cannot reach the camera. We
lift coordination into `OverviewView`, which already owns `flyTo`, `here`,
`beaconId`, and renders both `HereCard` and `OverviewIntro`.

- **`OverviewView` — new local first-run state machine.** A small state:
  `'intro' | 'spotlight' | 'done'`, initialized from `localStorage`
  (`'intro'` if unseen, else `'done'`). It drives which overlay renders and
  whether the map/HereCard show their spotlight treatment.
  - `intro → spotlight`: on the intro CTA. Persist the seen flag now (so a
    reload doesn't reshow the intro), call `flyTo(beaconId ?? \`dept:${here.dept.k}\`)`,
    and enter the dimmed/ringed spotlight.
  - `spotlight → done`: on any map interaction, Start, or a short auto-timeout —
    the spotlight is a light touch, not a second modal to dismiss.
  - Re-open ("?" chip): jump back to `'intro'` (does not clear the seen flag; it
    stays a deliberate reopen).

- **`OverviewIntro` (rewritten).** Becomes a controlled presentational card:
  props `onReveal()` (CTA) and `onClose()`. It no longer reads/writes
  `localStorage` or the camera itself — `OverviewView` owns that. Same
  localStorage key (`codepet:overview-intro-seen`) is retained so existing users
  who already dismissed the old intro don't see the new one on next visit.

- **`HereCard` (extended).** Accepts a `spotlight?: boolean` prop that adds the
  one-time glow ring (box-shadow only — no layout change). Default false keeps
  its normal appearance for all non-first-run renders.

- **Beacon color chip.** A small new presentational element rendered by
  `OverviewView` during `'spotlight'`, positioned near the beacon node, reading
  the beacon's state color from the existing `taskState(...)` /
  `STATE_HEX` the beacon already uses (`beaconHex`). One color, no full legend.

- **"? how to read this map" chip.** A persistent low-emphasis affordance on the
  Overview (visible after first run) that sets state back to `'intro'`. The
  reopened intro also exposes the full 4-color key (the legend simply moves here
  from its old always-upfront home).

## Data flow

`localStorage(seen)` → initial state → `OverviewView` renders `OverviewIntro`
(intro) **or** spotlight treatment **or** nothing. Intro CTA → persist seen +
`flyTo(beacon)` + `state='spotlight'`. Beacon color comes from the same
`here`/`beaconHex` the pulsing beacon already computes — one source of truth, so
the chip and the node can never disagree.

## Edge cases

- **No lit next move** (`here == null`, rare): the intro still shows, but the CTA
  cannot fly anywhere. It instead centers the map and opens byte's chat
  ("Ask byte") so the promise still resolves to *something*, then goes `'done'`.
- **Reload mid-spotlight:** seen flag is already persisted at CTA time, so a
  reload lands in `'done'` (normal Overview) — never re-traps the user.
- **Returning user who dismissed the old intro:** shared localStorage key means
  they start in `'done'`; the "?" chip is their path to the new explainer.
- **Reduced motion / mobile:** honor `prefers-reduced-motion` — skip the camera
  glide (jump-cut the framing) and the beacon breathe; the dim + ring + chip
  still convey the handoff. Keep the existing mobile-lite guardrails.

## Testing

- **Unit (state machine):** intro→spotlight persists seen + requests a fly to the
  beacon; spotlight→done on interaction/timeout; "?" reopens to intro without
  clearing seen; `here == null` routes CTA to chat, not a dead fly.
- **Presentational:** `OverviewIntro` renders the slim copy and fires
  `onReveal`; `HereCard spotlight` adds the ring without shifting layout; color
  chip reads the beacon's own state color.
- **Manual (Vercel PR preview, prod build — not `next dev`):** per project
  practice, verify first-run on the preview because StrictMode double-mount +
  resetCompanyData + HMR make first-run unreadable locally. Check: fresh browser
  → slim intro → CTA glides to beacon → ring + one color chip → Start works →
  reload shows no intro → "?" reopens it.

## Non-goals (YAGNI)

- No change to onboarding, scaffold, run loop, deliverables, or other views.
- No new multi-step tour, no full guided walkthrough to first deliverable
  (that was the larger scope option, explicitly not chosen).
- No new persistence backend — localStorage only, as today.
- No redesign of the map, ribbon, node colors, or `HereCard` content.

## Dependencies & sequencing

PR #71 (which introduced `OverviewIntro`) is **merged** — the component is now on
`origin/main` (verified 2026-07-06). This redesign therefore branches fresh off
`origin/main` as a clean, standalone PR touching only the first-run files
(`OverviewIntro`, `OverviewView`, `HereCard`, and the new color-chip / re-open
affordances), consistent with the "branch fresh off origin/main, touch only my
files" practice. Given concurrent sessions on the local checkout, do the work in
an isolated git worktree.
