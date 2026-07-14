# Demo "Let's build" — safe throwaway target for team testing

**Date:** 2026-07-14
**Goal:** Let teammates experience the REAL "Let's build" flow (byte plans → a live
Claude Code session builds it) without pointing it at real code. A default-ON
Settings toggle (`isDemoLetsBuild`) makes "Let's build" target a bundled, self-seeding
demo landing page at `~/codepet-demo` and pre-fills a suggested build so testers don't
have to think of one.

Decided in brainstorming (option b1): keep the real engine (real `claude`), only swap
the target. Testers still need Claude Code locally (or the copy-paste command) — that is
accepted, since the point is to feel the real thing.

## Current state (grounded in code)

- `armBuild` (`lib/store.tsx:~2484`): requires `buildProject.trim()`, resolves it to a
  local `dir` via `loadProjectDirs`, then branches on `getCapability()`:
  - **local** → snapshot checkpoint, `setBuildLocal(true)`, spawn (via `armBuildSession`).
  - **remote** → `command = terminalCommand(dir, buildOpeningPrompt(plan, brief))`,
    `armBuildSession(...)`, and `setBuildLaunchCommand(command)` so the UI shows a
    copy-paste command.
- `terminalCommand(dir, prompt)` (`lib/armSession.ts:45`) = `cd "<dir>" && claude "<prompt>"`.
- `armBuildSession` (`app/actions/build.ts`) is a `use server` action with fs/spawn — it
  writes `~/.claude/codepet/current-build.json` and, in local mode, opens Terminal.
- Intake: `startBuildIntake` → `addIntakeTurn` (accumulates `buildBrief`) → `generateBuildPlan`
  (`requestBuildPlan({ brief, project })`) → `buildPlan` → `armBuild`.
- `SettingsView` already has a `switch` toggle pattern (role="switch", class `switch on`).

## Target design

### 1. Setting: `demoLetsBuild` (default ON), localStorage-persisted
- Add store state `demoLetsBuild: boolean` + `setDemoLetsBuild(v)`, initialized from
  `localStorage['codepet:demoLetsBuild']`, **defaulting to `true`** when unset. The setter
  writes localStorage. (Client behavior only — no Firestore.)
- Expose both on the store context.
- `SettingsView`: a new `set-card` with a `role="switch"` toggle bound to
  `demoLetsBuild`/`setDemoLetsBuild`, labeled e.g. **"Demo Let's build"** with a sub line:
  *"Builds a throwaway landing page in `~/codepet-demo` instead of your real project — for
  trying the feature safely. On by default."* This card shows for all users (not dev-gated).

### 2. Demo target + self-seeding command
- New constants/helpers in `lib/armSession.ts`:
  - `DEMO_DIR = '~/codepet-demo'` (home-relative; the shell expands `~`).
  - `DEMO_SEED_HTML`: a minimal but real starter `index.html` (a barebones landing page —
    a `<title>`, an empty hero, a placeholder CTA) that byte will build out.
  - `demoTerminalCommand(prompt: string): string` — a one-liner that creates the demo dir,
    seeds `index.html` only if missing (so re-runs keep byte's progress), then runs claude:
    ```
    mkdir -p ~/codepet-demo && cd ~/codepet-demo && [ -f index.html ] || echo '<base64>' | base64 -d > index.html; claude "<prompt>"
    ```
    The seed is embedded **base64-encoded** to avoid shell-escaping the HTML. (Add a small
    unit test asserting the command contains `~/codepet-demo`, the decode, and `claude`.)

### 3. `armBuild`: demo branch
When `demoLetsBuild` is true:
- **Bypass** the `!buildProject.trim()` guard (no project needed) and skip
  `loadProjectDirs`; the target dir is `~/codepet-demo`.
- **remote mode**: `setBuildLaunchCommand(demoTerminalCommand(buildOpeningPrompt(plan, brief)))`
  — the copy-paste command self-seeds and runs. (Still call `armBuildSession` so the live
  ingest token/arm-file is set up; pass `projectDir: '~/codepet-demo'`.)
- **local mode**: `armBuildSession` must, in demo mode, **scaffold** the demo dir first —
  expand `~` to `os.homedir()`, `mkdirSync(demoDir, {recursive:true})`, and write
  `DEMO_SEED_HTML` to `index.html` if it doesn't exist — then proceed with the normal
  spawn/checkpoint against that dir. Add a `demo?: boolean` field to the arm input so the
  action knows to scaffold; keep the checkpoint snapshot (of the demo dir).
- Everything else (the "We're live" message, `setBuildStep('during')`, the live panel) is
  unchanged — the tester sees the real session.

### 4. Pre-filled suggestion
- Add `DEMO_BUILD_BRIEF` (a constant, e.g. *"A simple landing page for a neighborhood coffee
  shop — a warm hero with the name and tagline, three menu highlights, hours, and a 'Visit us'
  call-to-action."*).
- In `startBuildIntake`, when `demoLetsBuild` is true, pre-fill `buildBrief` with
  `DEMO_BUILD_BRIEF` (instead of empty) so `generateBuildPlan` can run immediately — the
  tester can still edit it, but doesn't have to invent one.

### 5. Demo banner
- In the build view (BuildCoachView / the "during" panel), when `demoLetsBuild` is true show
  a small, calm banner: **"Demo mode — building a throwaway landing page in ~/codepet-demo.
  Your real projects are untouched."**

## Data flow
No backend/schema change beyond the `demo` flag on the arm action input. The toggle is
client state (localStorage). The demo dir + seed live on the tester's machine, created by
the command/action at arm time.

## Out of scope
- A no-Claude-Code simulation (that was option b2, rejected).
- Changing the build engine, plan generation, or live-session protocol.
- Cleaning up `~/codepet-demo` automatically (re-runs reuse it; deleting is manual).

## Success criteria
- Settings shows a **default-ON** "Demo Let's build" toggle that persists across reloads.
- With it ON, "Let's build" needs no project pick, pre-fills a suggested landing-page brief,
  and (remote) yields a single copy-paste command that creates `~/codepet-demo` with a seed
  `index.html` and starts a real `claude` build against it — or (local) spawns the session
  there after scaffolding.
- Re-running does not wipe byte's earlier progress (seed only if `index.html` missing).
- With it OFF, "Let's build" behaves exactly as today (real project pick + build).
- `npm run typecheck`, `npm run lint` (no new errors), and `npm test` (incl. a new
  `demoTerminalCommand` test) pass.
