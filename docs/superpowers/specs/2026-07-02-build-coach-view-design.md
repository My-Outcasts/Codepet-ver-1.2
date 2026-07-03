# Build Coach View ("Cùng làm") — Design

**Date:** 2026-07-02
**Status:** Approved (design), pending implementation plan
**Source:** Chapter 3 of `codepet-demo-warm_2.html` (the START · DURING · END build-coach flow)

## Summary

Port **Chapter 3** of the warm CodePet demo into a new React view in the existing
Next.js app. It is an _interactive, self-contained coaching flow_ that teaches
good AI-building habits in three steps:

1. **START** — think before building (who is this for, what does "done" look like) → generate a plan.
2. **DURING** — watch the token budget ("heo đất xu"); overspending wakes Byte and unlocks a "check carefully" habit.
3. **END** — recap, run a checklist, and note what was learned to memory.

The data is **mocked/interactive** exactly like the demo (form inputs, a drag
slider, a static plan). It does **not** wire to real token tracking or Firestore
in this iteration — those are separate, already-in-progress concerns.

## Scope

**In scope**

- One new view, reachable from a new Sidebar entry "Cùng làm".
- The three-step START/DURING/END flow with Byte coaching, matching the demo's behavior.
- Adaptation to the app's existing **light, warm** theme (not the demo's dark palette).

**Out of scope (YAGNI)**

- Persisting anything to Firestore.
- Wiring the DURING budget to real Claude Code token usage.
- Changing the `Byte` sprite component (kept as the static PNG).
- The other four demo chapters (onboarding, dashboard, "day after", "while you sleep").

## Design Principles Applied

- **Match the existing design system, not the demo's colors.** The app uses a
  cream/paper light theme (`--page: #f8f7f3`, accent `--accent: #7c3aed`). The
  demo's dark tokens are NOT ported; only the layout, copy, and interaction are.
- **Isolate testable logic from UI.** The one piece of real logic — how the
  budget percentage maps to Byte's mood/label/unlock — is extracted into a pure
  helper so it is unit-tested independently of React.
- **No store surgery.** Flow state is component-local `useState`. The only store
  change is adding `'build'` to the `View` union.

## Component Architecture

All in `components/views/BuildCoachView.tsx`, decomposed into focused units:

| Unit             | Responsibility                                                                                                                   | Depends on                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `BuildCoachView` | Container. Holds `step` state, renders rail + active step + Back/Next nav.                                                       | `Byte`, sub-steps, `budgetState` |
| `StepRail`       | Progress rail: START · DURING · END with active/done states.                                                                     | —                                |
| `CoachBubble`    | Byte sprite + a line of coach text + a "lens" chip + an expandable "Byte kể nhỏ nghe nè" learn panel. Reused in all three steps. | `Byte`                           |
| `StartStep`      | Two inputs (làm cho ai / xong trông thế nào) + "sắp xếp thành kế hoạch" button that reveals a static plan card.                  | `CoachBubble`                    |
| `DuringStep`     | Budget meter ("heo đất xu") + slider. Dragging ≥80% flips Byte to worried and makes the "Kiểm tra kỹ" unlock card live.          | `CoachBubble`, `budgetState`     |
| `EndStep`        | Recap grid + a done checklist + a "ghi vào sổ tay" (context write) note.                                                         | `CoachBubble`                    |

Sub-components may live in the same file (each small and focused) since they are
only consumed by this view.

## State

Component-local `useState` in `BuildCoachView` (no Firestore, no global store):

- `step: 'start' | 'during' | 'end'` — current step; drives the rail and nav.
- `audience: string`, `doneLooks: string` — controlled inputs in START, pre-filled to match the demo.
- `planShown: boolean` — whether the generated plan card is visible.
- `budgetPct: number` — slider value in DURING (10–100).
- `unlocked: boolean` — whether the "Kiểm tra kỹ" habit has been unlocked (latches once true).

The expandable learn panels use their own local open/closed state inside `CoachBubble`.

### Pure helper (unit-tested)

```ts
// Derives Byte's DURING-step reaction from the budget slider.
function budgetState(pct: number): {
  label: string; // e.g. "đang ổn 😌" vs "lo quá! 😰"
  mood: 'ok' | 'worried';
  warn: boolean; // true at/above the danger threshold
  unlock: boolean; // whether this reading should unlock the habit
};
```

Threshold: `pct >= 80` → `mood: 'worried'`, `warn: true`, `unlock: true`; otherwise the calm state. The container latches `unlocked` so it stays unlocked once triggered.

## Byte & Mood

The demo recolors its inline pixel pet (idle / happy / worried). The app's `Byte`
is a single static PNG (`/byte.png`), so recoloring is not possible. Instead:

- Keep `Byte` **as-is** (static sprite).
- Express mood through **copy + emoji + a small state chip** (e.g. "lo quá 😰").
- Add a subtle CSS `bob` animation on the sprite wrapper for liveliness.

This is an honest trade-off: the emotional beat is carried by text and a status
chip rather than by recoloring the sprite.

## Integration Points

- `lib/store.tsx` — add `'build'` to the `View` union type.
- `components/AppRoot.tsx` — add a branch: `view === 'build' → <BuildCoachView />`.
- `components/Sidebar.tsx` — add a "Cùng làm" nav item in the main group (near Tasks).
- `app/globals.css` — add a scoped style block, class prefix `.bc-*`, built from the
  existing light-theme tokens; reuse existing `.view` / `.vhead` / card patterns.

## Data Flow

Purely local and synchronous:

1. START: user edits the two inputs → clicks "sắp xếp" → `planShown = true` reveals the static plan.
2. DURING: user drags the slider → `budgetPct` updates → `budgetState(pct)` recomputes the meter fill, Byte's text/chip, and (once ≥80%) latches `unlocked = true` to make the habit card live.
3. END: static recap + checklist + context-write note. "Next" from END returns to the START step (or navigates away — see Open Questions).

No network calls, no error states beyond ordinary controlled-input handling.

## Testing

- **Unit (Vitest):** `budgetState()` at boundaries — 79 (calm), 80 (worried/warn/unlock), 100 (worried).
- **Manual:** walk the three-step flow, confirm rail states, plan reveal, slider→mood transitions, unlock latch, and learn-panel toggles.

## Open Questions (non-blocking; defaults chosen)

- **Entry point:** defaulting to a new Sidebar item "Cùng làm". Alternative was launching from a Task (Tasks → run). Can revisit.
- **End of flow:** "Next" from END returns to START for now (the demo jumps to Chapter 4, which is out of scope). Could instead route to `tasks` or show a "done" state.
