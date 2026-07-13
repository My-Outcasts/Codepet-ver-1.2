# Second Brain overview — trim the UI down to the galaxy + a value strip

**Date:** 2026-07-10
**Scope:** `SECOND_BRAIN_V2` mode of the Overview screen only. No change to the
non‑v2 (`SECOND_BRAIN_V2 === false`) layout.

## Goal

Keep the galaxy as the hero. Strip the peripheral UI ("râu ria") so the screen
shows the galaxy full‑width plus one compact strip that communicates value at a
glance — nothing more.

## Current state (v2)

`components/views/OverviewView.tsx` renders, in v2:
- Left column (320px): `<Copilot inline />` chat rail.
- Center map wrapper inset to `left:320 / right:326` (galaxy is boxed between the
  two side columns).
- Title "Second Brain" + subtitle + empty‑state backfill button.
- "Ask your Second Brain" recall search box (input + hits list).
- Right column (300px): `<SecondBrainPanel />` — Status (4 rows), Brain (2),
  Do‑this‑next, Usage (5), Topics (per‑dept). ~11+ fields.
- Bottom legend (5 colored dots).
- Toggleable "What changed" timeline panel.

`components/AppRoot.tsx` (`sbMode`) suppresses BOTH the docked `<Copilot />` and
the floating "Ask byte" launcher, so the left rail is currently the only chat
instance on this screen.

## Target design

**Galaxy full‑width.** The map wrapper (`wrapRef` div) drops the `left:320 /
right:326` insets and fills the section (small top inset preserved so the title
strip has room; behavior otherwise unchanged — drag/orbit, scroll/zoom, click a
star to open).

**Removed / hidden in v2:**
- Left `<Copilot inline />` chat rail.
- Right `<SecondBrainPanel />` (the dense field panel).
- "Ask your Second Brain" search box (input, submit, hits, `runAsk`/`askHits`
  UI). The recall handler code may stay unused or be removed if it leaves no
  other references — implementation decides; no behavior depends on it once the
  box is gone.
- Bottom legend (the 5 `<Legend />` dots in v2).
- "What changed" timeline panel and its trigger.

**Chat access preserved via the floating launcher.** Flip `AppRoot.tsx` so the
floating "Ask {companion}" button (and its toggle target, the docked Copilot)
is available in `sbMode` again — i.e. the `!sbMode &&` guards on the launcher
button, and on `<Copilot />`, are relaxed so chat opens on demand instead of
living in a permanent column. Net: chat is one click away, not always on screen.

**Value strip (replaces the whole right panel).** A slim, low‑chrome block under
the title at top‑left:
- Line 1 — three core value numbers, dot‑separated:
  `{deliverables} deliverables · {decisions} decisions · ~{hoursSaved}h saved`
  - Source: `ledgerCounts(events)` for deliverables/decisions;
    `tracking.hoursSaved` for the third.
  - A metric renders only when > 0; if all three are 0, the line is omitted.
- Line 2 — "Việc tiếp theo" / next step, when `nextStep` exists: a clickable
  row showing `nextStep.taskTitle`; clicking calls `flyTo(\`dept:${nextStep.deptK}\`)`
  (same fly‑to the panel used via `onTopic`). Hidden when `nextStep` is null.
- Empty state unchanged: for a brand‑new account (`events.length === 0`) keep the
  "Load my past work" backfill button already present near the title.

Title + subtitle stay (subtitle trimmed to a single calm line).

## Data flow

No new data. Reuses values already computed in `OverviewView`:
`events`, `ledgerCounts`, `tracking`, `nextStep`, `flyTo`. `SecondBrainPanel`
is no longer rendered here (file can remain for reference; not deleted).

## Out of scope

- Non‑v2 Overview layout (unchanged).
- Galaxy rendering / firefly visuals (unchanged).
- Any backend / recall server behavior.

## Success criteria

- In v2, the galaxy fills the screen with no left/right columns.
- Only the title, the value strip (≤ 2 lines), and — for empty accounts — the
  backfill button appear over the map.
- Chat with byte is reachable via the floating launcher.
- Search box, legend, timeline, and the dense right panel are gone.
- No console errors; unused handlers/imports cleaned up so the build is clean.
