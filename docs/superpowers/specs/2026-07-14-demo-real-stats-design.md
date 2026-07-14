# Demo "Let's build" — real recap stats for remote testers (self-report, no install)

**Date:** 2026-07-14
**Goal:** Let remote (Vercel) testers see **real** recap stats — committed count, wins,
files changed — from the demo build, without installing the Codepet toolkit. The demo
copy-paste command self-reports a git rollup (with the ingest token + buildSessionId baked
in) to a new endpoint; the recap reads it back.

Decided in brainstorming: no toolkit install (rejected). The live/track hooks need
`track.json` (installer-only) so they can't be relied on. Instead the demo command itself
POSTs a git rollup. The "spent (actions)" count needs Claude's transcript and can't be
derived from a shell command, so it stays unavailable remotely (shown honestly as "—").

## Current state (grounded)

- The store already **subscribes to `liveBuilds/{buildSessionId}`** in remote mode
  (`lib/store.tsx:571` — `if (!companyId || !buildSessionId || buildLocal) return;
  subscribeLiveBuild(...)`), exposing it as `buildLive`.
- `EndStep` (recap, `components/views/BuildCoachView.tsx`) reads `commits`/`wins` from `ev`
  (`loadTrackEventForSession(companyId, sessionId)`), which is empty remotely (no hook), and
  `actions` from `buildLive.actionCount`.
- `demoTerminalCommand(prompt)` (`lib/armSession.ts`) is the remote copy-paste command; it's
  built in `armBuild`'s remote-demo branch (`lib/store.tsx`), where `companyId`, the
  buildSessionId (`id`), the ingest `token` (`ensureIngestToken`), and `apiUrl`
  (`window.location.origin`) are all in scope.
- `LiveState` (`lib/liveBuild.ts`) is written by `/api/track/live` via `reduceLive`; it has
  `sessionId`, `actionCount`, etc. — no commits/wins.

## Target design

### 1. `LiveState.recap` field
Add to `LiveState` (`lib/liveBuild.ts`):
```ts
recap?: { commits: number; wins: string[]; filesChanged: number };
```
(Optional; only set by the demo self-report.)

### 2. New endpoint `POST /api/track/demo-recap`
`app/api/track/demo-recap/route.ts` (Node runtime), mirroring `/api/track/live`'s auth:
- Body: `{ companyId, token, buildSessionId, commits, wins, filesChanged }`.
- Auth: `token === companyDoc.ingestToken` (same check as `/api/track/live`); else 401.
- Validate/clamp: `buildSessionId` non-empty string; `commits`/`filesChanged` finite
  non-negative integers; `wins` an array of strings (cap length + count, e.g. 10 × 200 chars).
- Writes `liveBuilds/{buildSessionId}` with `{ recap: { commits, wins, filesChanged } }` via a
  transaction that **merges** into the existing doc (so it doesn't clobber a live `actionCount`
  if one exists): `tx.set(ref, { recap }, { merge: true })`.

### 3. `demoTerminalCommand` self-reports
Change the signature to carry the report credentials:
```ts
demoTerminalCommand(prompt: string, report?: { apiUrl: string; companyId: string; buildSessionId: string; token: string }): string
```
When `report` is present, append after `claude "<prompt>"` (and before/after the serve+open
from the previous feature) a git rollup + curl:
```
; C=~/codepet-demo
; commits=$(git -C "$C" rev-list --count HEAD 2>/dev/null || echo 0)
; wins=$(git -C "$C" log --format=%s -n 10 2>/dev/null | ... -> JSON array)
; files=$(git -C "$C" ls-files 2>/dev/null | wc -l | tr -d ' ')
; curl -s -X POST <apiUrl>/api/track/demo-recap -H 'content-type: application/json' \
    -d "{\"companyId\":\"…\",\"token\":\"…\",\"buildSessionId\":\"…\",\"commits\":$commits,\"filesChanged\":$files,\"wins\":[…]}" >/dev/null 2>&1
```
Implementation notes:
- Build the JSON safely — `wins` needs JSON-escaping; the simplest robust approach is to
  compute the numeric fields in the shell and let the command assemble a minimal JSON, or
  post `wins` as a newline-joined string field the endpoint splits. **Prefer**: post
  `commits`/`filesChanged` as shell-substituted numbers and `wins` as a single
  `winsText` string (git subjects joined by ``), and have the endpoint split
  `winsText` on that separator — avoids fragile per-line JSON escaping in the shell.
- Best-effort (`curl -s … || true`): a failed report must never break the tester's session.
- Keep the existing serve+open (`python3 -m http.server 4321 … open …`) — run the report
  before or after it; both are fine (they're independent).

### 4. `armBuild` passes the report credentials
In `armBuild`'s remote-demo branch (`lib/store.tsx`), call
`demoTerminalCommand(buildOpeningPrompt(buildPlan, buildBrief), { apiUrl: window.location.origin, companyId, buildSessionId: id, token })`.
(Local-demo doesn't use `demoTerminalCommand`, so no change there.)

### 5. Recap reads the self-reported rollup
`EndStep` gets the recap rollup from `buildLive` (pass `recap={buildLive?.recap ?? null}` from
the parent, alongside the existing `actions`). Then:
- `commits = ev?.commits ?? recap?.commits ?? 0`
- `built = ev?.wins?.[0] ?? recap?.wins?.[0] ?? plan?.title ?? brief`
- `committed` tile: `commits >= 1 ? \`${commits} ✓\` : '—'` (unchanged logic, now fed by recap).
- **spent** tile: when there is no real action count (demo/remote: `actions === 0` and a
  `recap` exists) show `'—'` instead of `0/{target} actions` — honest, since actions aren't
  tracked remotely. Optionally show `${recap.filesChanged} files` as the spent-tile value in
  that case (concrete "real work" without a fake action count).

## Data flow
Tester runs the copy-paste command → claude builds in `~/codepet-demo` (a git repo, from the
earlier `git init`) → the command computes a git rollup and POSTs it to
`/api/track/demo-recap` with the baked-in token + buildSessionId → the endpoint writes
`liveBuilds/{buildSessionId}.recap` → the store's existing `subscribeLiveBuild` pushes it to
`buildLive.recap` → the recap shows real committed + wins + files.

## Security note
The ingest token is embedded in the copy-paste command (visible to the tester). It only
grants write to this company's track/live ingest (same token the installed hooks use).
Acceptable for internal testing; documented, not hidden.

## Out of scope
- A real "spent (actions)" count remotely (needs the transcript; shown as "—").
- Live DURING streaming for remote (still hook-only).
- Any change to the non-demo or local-demo paths.
- Requiring/registering the toolkit.

## Success criteria
- After a remote demo build, the recap shows the **real** committed count and wins (and a
  files-changed figure), with "spent" honestly "—" (or the files count), no toolkit install.
- The endpoint rejects a bad/blank token (401) and clamps its inputs.
- Non-demo and local-demo recaps are unchanged.
- `npm run typecheck`, `npm run lint` (no new errors), `npm test` (incl. new endpoint + any
  reduce/merge unit tests, and the updated `demoTerminalCommand` test) pass.
