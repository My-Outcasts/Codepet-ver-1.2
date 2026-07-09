# Second Brain — Spec #4 (Chitti-style 3-column layout)

**Codepet · Design Spec** — *Approved for implementation*
Date: 2026-07-09 · Owner: Overview / Second Brain
Depends on: Specs #1–#3 (ledger, graph, recall, timeline) — shipped.

---

## 0 · Scope

Make the Second Brain view read like the Chitti OS reference: a full-screen 3-column layout —
**chat (left) · knowledge galaxy (center) · info rail (right)** — driven entirely by Codepet's
real data. Gated behind the existing `NEXT_PUBLIC_SECOND_BRAIN_V2` flag; off = today's Overview.

This is a frontend layout project on top of the existing renderer. The 3D graph tech is
unchanged (per the earlier non-goal); we add the two side rails and increase graph density.

### Decisions (locked in brainstorming)

| Question | Decision |
|---|---|
| Placement | Replace the **Overview** tab's content when `SECOND_BRAIN_V2` is on (no new tab) |
| Left chat | **Reuse the existing byte chat (`Copilot`)** in an inline mode (no chat rewrite) |
| Right rail | New `SecondBrainPanel` — sections mapped to **real** data, not Chitti's capture sources |
| Voice orb / Share screen / capture STATUS | **Omitted** (audio/capture are non-goals) |
| Galaxy | Denser + labeled: add `references` cross-links, labels on high-weight nodes |

**Non-goals:** no audio/voice, no screen capture, no new nav tab, no chat rewrite, no renderer
swap, no new backend data (all rail content derives from existing store state).

---

## 1 · Layout (Section A)

When `SECOND_BRAIN_V2`, `OverviewView` renders a 3-column CSS grid filling the view:

```
┌────────────┬───────────────────────────┬────────────┐
│  chat rail │   knowledge galaxy (3D)    │  info rail │
│  (Copilot) │   (existing ForceGraph3D)  │ (new panel)│
│   ~320px   │          flex-1            │   ~300px   │
└────────────┴───────────────────────────┴────────────┘
```

- Off → today's single-pane Overview (unchanged).
- The center keeps all existing overlays (header, Ask panel, Timeline toggle) but they no longer
  need to carry the whole UI — the rails do.
- Responsive: on narrow widths the rails collapse (right rail first, then left) so the galaxy
  always has room; rails become toggercible drawers under a breakpoint.

## 2 · Left chat rail (Section B)

- Reuse `components/Copilot.tsx`. Add an `inline?: boolean` prop: when true, Copilot renders as a
  normal flex child (no fixed/overlay positioning, no collapse chrome) sized to its column.
- All existing behavior (history, streaming, tools, recall augmentation) is untouched.
- In the v2 Overview grid, the left column mounts `<Copilot inline />`.

## 3 · Right info rail (Section C)

New `components/views/overview/SecondBrainPanel.tsx`, consuming store state only:

| Section | Source | Content |
|---|---|---|
| **STATUS** | `events` | counts by type: Deliverables · Decisions · Milestones · Sessions |
| **BRAIN** | `companionId` + model constant | active model (claude-opus-4-8) + companion name |
| **DO THIS NEXT** | `nextStep` | byte's next move (title + dept); empty → "You're all caught up" |
| **USAGE** | `tracking` | calls / tokens if present on `TrackingSummary`; omit rows that are absent |
| **TOPICS** | `events` + `DEPTS` | department name + event count, desc; click → focus that dept node |

Pure helper `lib/overview/secondBrainStats.ts`:
- `ledgerCounts(events): { deliverables, decisions, milestones, sessions }`
- `topicCounts(events, depts): Array<{ deptK, name, count }>` (desc, drop zero)
Both pure + unit-tested.

## 4 · Galaxy density + labels (Section D)

In `lib/overview/knowledgeGraph.ts`:
- Add `references` edges: link knowledge nodes that share a `deptK` to each other (capped per
  dept, e.g. a small mesh, not full N²) so clusters read as connected webs, not stars on a stalk.
- Expose a `label: boolean` hint on `KGNode` for high-weight nodes (top-N by weight per kind);
  the view shows a persistent SpriteText for those, hover for the rest.

Keep the change bounded and tested (the existing `knowledgeGraph.test.ts` extends: assert
`references` edges only connect same-dept nodes and stay within the cap).

## 5 · Phasing

Each phase is independently mergeable and leaves the app working (flag-gated throughout).

- **Phase 1 · Right rail** — `SecondBrainPanel` + `secondBrainStats.ts` (+ tests), mounted as a
  right-side overlay in the current single-pane v2 view. Immediate visible value.
- **Phase 2 · 3-column layout** — the grid + `Copilot inline` mode; move the right rail into the
  grid; responsive collapse.
- **Phase 3 · Galaxy density + labels** — `references` edges + high-weight labels.

## 6 · Testing

- `lib/overview/secondBrainStats.test.ts` — `ledgerCounts` + `topicCounts` (counts, ordering,
  zero-drop) with stub events.
- `knowledgeGraph.test.ts` — extend for `references` edges (same-dept only, capped) and the
  `label` hint (top-N by weight).
- Layout/rails verified manually with the flag on (WebGL/authed — not unit-testable).

---

## 7 · Verification

- Flag off → Overview byte-for-byte unchanged.
- Flag on → 3-column Second Brain: byte chat left, denser labeled galaxy center, real-data info
  rail right (status counts, next move, topics with counts). No voice/capture UI.

---

*Spec #4 — the Chitti-style Second Brain layout. Builds on the shipped ledger/graph/recall.*
