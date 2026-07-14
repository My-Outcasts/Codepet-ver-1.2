# Demo "Let's build" — view & re-view the built page

**Date:** 2026-07-14
**Goal:** After the demo build writes/edits `~/codepet-demo/index.html`, the tester can
**see** the result, and re-open it any time (even after closing the browser tab) via a real
clickable button — not a copy-paste command. Works for remote (Vercel) testers, since the
built file lives only on their machine.

Decided in brainstorming: a remote app can't open a local file (and `file://` links are
blocked from https), so the demo is **served over localhost** and the button links there —
`http://localhost:4321` resolves on the tester's own machine. Python's stdlib server
(`python3 -m http.server`) at a fixed port **4321**.

## Current state (from the demo feature already built)

- `lib/armSession.ts`: `DEMO_DIR='~/codepet-demo'`, `DEMO_SEED_HTML`, and
  `demoTerminalCommand(prompt)` — currently: `mkdir -p ~/codepet-demo && cd ~/codepet-demo &&
{ [ -f index.html ] || echo '<b64>' | base64 -d > index.html; } && claude "<prompt>"`.
- `components/views/BuildCoachView.tsx`: a demo banner is shown (in the shared `bc-body`
  wrapper) when `demoLetsBuild` is true.

## Target design

### 1. `demoTerminalCommand` serves + opens on finish

Constants in `lib/armSession.ts`:

- `export const DEMO_PORT = 4321;`
- `export const DEMO_URL = 'http://localhost:4321';`

`demoTerminalCommand` appends, after the `claude` build, a background static server for the
demo dir (which is the cwd) and opens the browser:

```
… && claude "<prompt>" ; python3 -m http.server 4321 >/dev/null 2>&1 & sleep 1 && open http://localhost:4321
```

- The `;` (not `&&`) before the server means it serves even if claude exits non-zero.
- `python3 -m http.server 4321 &` backgrounds the server (runs until the terminal closes);
  `sleep 1` lets it bind before `open` navigates the browser to it.
- If a server is already bound to 4321 (a prior run), the new one fails harmlessly and the
  existing one keeps serving — `open` still works.
- macOS-first (`open`), consistent with the rest of the build flow.

Update `lib/armSession.test.ts`: the `demoTerminalCommand` test also asserts the command
contains `python3 -m http.server 4321` and `open http://localhost:4321`.

### 2. "Open demo →" button in the build view

In `BuildCoachView.tsx`, when `demoLetsBuild` is true, render an **"Open demo →" link** to
`DEMO_URL` (`target="_blank"`, `rel="noopener noreferrer"`) — placed with/next to the demo
banner in the shared `bc-body` wrapper, so it's visible in both the DURING and END steps.

- It's a plain `<a href="http://localhost:4321">`, so clicking (re)opens the demo in a new
  tab — a real button that works whether the app runs locally or on Vercel (localhost is the
  tester's machine). Top-level navigation to `http://localhost` is allowed from https (not
  blocked as mixed content).
- Copy/tone: banner reads e.g. _"Demo mode — building a throwaway landing page in
  `~/codepet-demo`."_ with the **Open demo →** link beside it.
- Import `DEMO_URL` from `@/lib/armSession` (avoid hard-coding the URL in the component).

## Data flow

No backend/state change. The server runs on the tester's machine (launched by the demo
command); the app only renders a static link to `DEMO_URL`.

## Out of scope

- Reading/rendering the built HTML inside the app (Vercel can't read the tester's file).
- Auto-restarting the server if the tester closes the whole terminal (re-running the build
  restarts it). Closing only the browser tab → the button re-opens it while the server runs.
- Non-macOS `open` equivalents / non-python servers (macOS + python3 assumed, like the rest
  of the flow).

## Success criteria

- The demo copy-paste command ends by serving `~/codepet-demo` on `localhost:4321` and
  opening the browser to it.
- The build view shows an **Open demo →** link to `http://localhost:4321` in demo mode
  (both during and recap) that opens the page in a new tab, and re-opens it after the tab is
  closed (while the server is up).
- `npm run typecheck`, `npm run lint` (no new errors), and `npm test` (updated
  `demoTerminalCommand` test) pass.
