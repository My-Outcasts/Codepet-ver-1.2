# Build Coach in chat — design

Date: 2026-07-06
Status: approved (pending spec review)

## Problem

"Let's build" is currently its own sidebar tab (`view: 'build'` in `Sidebar.tsx`)
that renders the full-screen `BuildCoachView` — a three-step flow (START → DURING →
END) bracketing one real `claude` Code session. As a standalone tab it feels heavier
than the rest of the app, and it duplicates the "entry surface" concept: the founder
already talks to Byte in the chat panel for everything else.

We want the build experience to start **from the chat**, not from a dedicated tab.
The founder should be able to kick off a build with a natural conversation with Byte,
and only the live session itself (the part that genuinely needs width) takes over the
main area.

## Goal

Merge the build experience into the byte chat flow:

- Remove the "Let's build" sidebar tab.
- Add a **"Let's build"** button in the chat empty-state.
- START (decide what to build → plan) happens as a **natural, lightly-scripted
  conversation** inside the 340px chat panel.
- DURING (watch the real `claude` session + budget meter) **expands into the wide main
  area**, reusing the existing `LiveChat` / meter / habit UI. The chat stays on the
  right so Byte keeps coaching from `live` state.
- END (recap + save to notebook) shows in the main area; Byte posts a closing nudge in
  chat.

Non-goals: redesigning the live-session transcript, changing the plan/arming server
routes, or building an AI-driven dynamic intake (see "Decisions" below).

## Layout facts (why this split)

- `shell` grid is `212px 1fr 340px` — Sidebar | main (`ActiveView`) | Copilot chat.
- The chat panel (`.copilot`) is a fixed **340px** right column, present on every view.
- `BuildCoachView` currently owns all flow state as local `useState` — the chat cannot
  reach it. This is the core thing the design changes.

## Decisions (confirmed with the user)

1. **Merge fully into chat** (not just relocate the tab's entry point).
2. **DURING expands into the main area**; chat stays for coaching.
3. **START is a scripted-natural conversation** — Byte asks in natural language via a
   short fixed script (one opening question + at most one follow-up), NOT an AI-driven
   dynamic intake. The plan is generated from the accumulated intake text via the
   existing `requestBuildPlan`. (AI-driven intake would require extending `/api/chat`
   with a build-intake mode + a "ready to plan" signal — deferred, YAGNI.)
4. **Entry points**: the empty-state button is the primary entry. To cover the case
   where the chat is not empty (a build can't otherwise be started once the tab is
   gone), **Byte proactively offers a "Let's build" button** when the founder expresses
   wanting to build/code something themselves. Implemented via a new `offer_build`
   tool + `BUILD_MARK` streaming marker, mirroring the existing `run_task` /
   `ACTION_MARK` mechanism — the reply attaches a transient `buildAction: 'begin-intake'`
   button that calls the existing `startBuildIntake()`.
5. **State architecture: option A** — lift build-flow state into the existing store
   slice (`AppProvider`), rather than a new dedicated context provider.

## Architecture

### State — build-flow slice in the store (`lib/store.tsx`)

Move the flow state out of `BuildCoachView` local state into `AppState` so both the
chat panel and the main view read/write one source of truth.

Fields:

- `step: 'during' | 'end'` (START no longer has a main-area step)
- `project: string`
- `brief: string` (the accumulated intake text handed to the planner)
- `plan: BytePlan | null`
- `buildSessionId: string | null`
- `live: LiveState | null`
- `local: boolean`
- `launchCommand: string | null`
- `projectDir: string`
- `arming: boolean`
- `intakeActive: boolean` (chat is mid-intake; used to render intake affordances)

Actions:

- `startBuildIntake()` — sets `intakeActive`, posts Byte's opening question into chat.
- `generateBuildPlan()` — calls `requestBuildPlan({ brief, project })`, stores `plan`,
  posts the plan card message.
- `armBuild()` — the current `startBuild` logic from `BuildCoachView` (getCapability →
  local: set `buildSessionId` + subscribe; remote: `armBuildSession` + `launchCommand`),
  then `show('build')` and `step = 'during'`.
- `resetBuildFlow()` — clears the slice (the "Start over" path).

The `subscribeLiveBuild` effect moves from `BuildCoachView` into the store provider so
the subscription is independent of which view is mounted; when the rollup marks the doc
ended, the store sets `step = 'end'`.

### Chat (`components/Copilot.tsx`)

- **Empty-state**: add a primary **"Let's build"** button alongside the existing
  `CHIPS`. Tapping it calls `startBuildIntake()`.
- **Intake**: Byte posts a natural opening question (fixed script, e.g. "What do you
  want to build — who's it for, and what does done look like?"). The founder replies
  freely (one or more messages). Byte's message carries a **"Turn this into a plan →"**
  action; the founder can keep typing to add detail before tapping it. Script allows at
  most one Byte follow-up.
- **Plan card**: a new `ChatMessage` variant `buildPlan?` renders the plan (title,
  steps, ~N actions) with a **"Start building"** button that calls `armBuild()`.
- **Coaching during DURING**: the chat reads `live` from the store and surfaces Byte's
  coaching line (reuse `byteDuringLine` / budget warnings). On `live.ended`, Byte posts
  a closing "let's write it down" nudge.
- **Mid-conversation entry**: reuse the in-chat `action` mechanism so Byte can offer a
  "Let's build" button when the founder's message is about building.

New `ChatMessage` fields (in `lib/store.tsx`):

- `buildPlan?: BytePlan` — the message renders it as a plan card (title, steps,
  `budgetActions`) plus a "Start building" button wired to `armBuild()`.
- intake questions reuse the plain byte bubble; the "Turn this into a plan →" and
  "Let's build" buttons reuse the existing in-chat `action` button mechanism with a
  build-scoped label (no new field needed for those).

### Main view (`components/views/BuildCoachView.tsx` — shrinks)

- Remove `StartStep` entirely (moved to chat).
- The component renders only **DURING** and **END**, reading all state from the store
  (no local `useState`).
- Rail shrinks to two rungs (DURING · END) or is dropped.
- `armSession.ts`, `LiveChat.tsx`, the budget meter, the habit-unlock block, and
  `EndStep` are reused unchanged.

### Sidebar (`components/Sidebar.tsx`)

- Remove the `{ view: 'build', label: "Let's build", icon }` entry.
- `'build'` stays in the `View` union and the `AppRoot` switch; it is only entered
  programmatically from `armBuild()`.

## Data flow

```
Copilot (chat, 340px)                     store slice                 main (1fr)
─────────────────────                     ───────────                 ─────────
[Let's build] ─ startBuildIntake() ─────▶ intakeActive=true
Byte opening question  ◀──────────────────┘
founder free-text replies (chat msgs)
[Turn into a plan →] ─ generateBuildPlan() ▶ requestBuildPlan()
plan card  ◀──────────────────────────────┘ plan set
[Start building] ─ armBuild() ───────────▶ arm + show('build'),      DURING mounts
                                            step='during'            (LiveChat+meter)
Byte coaching  ◀──── live (subscribe) ────  live updates
Byte "write it down" ◀── step='end' ──────  live.ended               END recap
                        resetBuildFlow() ◀── [Start over]            unmount
```

## Error handling

- `requestBuildPlan` failure: Byte posts a retry message in chat (mirrors the current
  `StartStep` error copy); intake stays active so the founder can retry.
- Remote (non-local) capability: `armBuild()` keeps the existing copy-paste
  `launchCommand` fallback surfaced in the DURING main view.
- No `companyId` / not signed in: `armBuild()` no-ops (same guard as today).

## Testing

- Keep the existing `lib/armSession.ts` unit tests (pure helpers, unchanged).
- Add pure unit tests for the store build-flow reducer/actions:
  - accumulating `brief`, then `armBuild()` sets `view === 'build'` and `step === 'during'`
  - `live.ended` transitions `step` to `'end'`
  - `resetBuildFlow()` clears the slice
- If the intake message → plan mapping grows any pure logic, unit-test that mapping.

## Out of scope / deferred

- AI-driven dynamic intake (Byte deciding its own questions and "ready to plan" signal).
- Any change to `/api/build-plan`, `/api/build-session/*`, or `armBuildSession`.
- Persisting intake turns differently from normal chat messages (they are ordinary
  persisted chat messages).
