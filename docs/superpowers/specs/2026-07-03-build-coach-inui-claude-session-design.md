# Build Coach — in-UI Claude Code session ("Let's build" as a two-way chat)

**Date:** 2026-07-03
**Status:** Draft for review

## Problem

Today "Let's build" arms a session and **opens a Terminal** running `claude`; the
web UI only _watches_ activity through hooks (a budget meter + Byte's narration).
The builder cannot converse with Claude from the app — to answer a question,
approve a tool, or send a follow-up they must leave the UI for the Terminal.

We want "Let's build" to feel like **working with Claude Code inside the app**:
the user types a brief, picks a project, and Codepet drives the real `claude` on
their machine and streams the conversation back into a chat UI — including typing
follow-ups and approving/denying tool permissions, all in the browser.

## Goals

- Type a brief + pick a project → the app runs the **real local `claude` CLI** in
  that project and streams its responses into an in-UI chat transcript.
- **Two-way:** the user can send follow-up turns from the UI.
- **Permissions in the UI:** when Claude wants to edit a file or run a command,
  the UI shows an Allow / Deny prompt; the decision drives the real session.
- Preserve Codepet's teaching frame: START (Byte plans) and END (recap + notebook)
  stay; Byte still coaches (budget meter, double-check) alongside the chat.

## Non-goals

- **Remote/hosted mode.** This runs only in **local mode** (the Next.js server on
  the user's machine — the same boundary `armBuildSession` already draws). In
  remote mode the current copy-paste command + hook meter remain the fallback.
- Replacing the existing Terminal path entirely — it stays as the remote fallback.
- Multi-user session sharing, cloud persistence of transcripts, or resuming a
  session across app restarts (a killed process ends the session).
- Using the Claude Agent SDK or the Anthropic API directly — we drive the user's
  installed `claude` CLI (their login/subscription/settings/hooks/MCP).

## Decisions (from brainstorming)

- **Engine:** the real `claude` CLI, headless streaming.
- **Permissions:** surfaced as Allow/Deny in the UI (safest, terminal-like).
- **Flow:** the chat **replaces the DURING step**; START and END are unchanged.
- **Runtime:** local mode only.
- **Delivery:** one spec, built in **three phases** (P1 one-way stream → P2 two-way
  → P3 UI permissions). Each phase ships something usable.

## Claude Code headless facts this design relies on

Confirmed against Claude Code 2.x (exact JSON shapes to be re-verified against the
installed CLI when the plan is written):

- **Headless multi-turn streaming:**
  `claude -p --input-format stream-json --output-format stream-json --verbose`
  run with the project as `cwd`. The process **stays alive** between turns; new
  user turns are written to **stdin** as newline-delimited JSON messages, and
  events stream out on **stdout** as newline-delimited JSON (system/init,
  assistant text, tool_use, tool_result, result, error/retry). A `session_id`
  appears in the init/result events.
- **Permission routing:** `--permission-mode` controls auto-approval;
  `--permission-prompt-tool <mcp_tool>` routes each permission decision to an MCP
  tool that returns `{ decision: "allow" | "deny", updatedInput?, reason? }`, and
  the CLI blocks that tool call until it returns.
- **Interim mode (P1/P2):** `--permission-mode acceptEdits` (auto-approves file
  edits + safe FS ops; still safe-ish for a first cut) until P3 wires the prompt
  tool.

## Architecture

Local server IS the bridge — no separate daemon. Next.js (Node runtime) spawns and
holds the child `claude` process across requests via a module-level registry.

```
Browser (DuringStep chat)
   │  ▲
   │  │  SSE (server→client): normalized events
   │  │      GET /api/build-session/stream?id=…
   │  ▼
POST /api/build-session/{start,send,stop,permission}
   │
   ▼
Session engine (lib/liveSession/engine.ts)   ── module-level registry: id → { child, emitter, pending }
   │  spawn: claude -p --input-format stream-json --output-format stream-json
   │         --verbose  (cwd = projectDir)  [P3: --permission-prompt-tool codepet_permit]
   │  stdin  ← user turns (JSON)
   │  stdout → parseEvents() → normalized events → emitter → SSE
   │
   └─[P3] MCP permission server (lib/liveSession/permissionServer.mjs)
             claude calls codepet_permit(tool_name, tool_input, …)
                → POST localhost /api/build-session/permission/enqueue  (parks, awaits)
                → UI shows Allow/Deny → POST /permission → resolves → returns decision
```

### Units (each: one responsibility, own interface, independently testable)

**1. `lib/liveSession/parseEvents.ts` — pure**
`parseEventLine(line: string): SessionEvent | null` and a small streaming helper
that buffers partial lines. Maps raw stdout JSON to a normalized union:

```ts
type SessionEvent =
  | { kind: 'init'; sessionId: string }
  | { kind: 'assistant-text'; text: string; delta: boolean }
  | { kind: 'tool-use'; id: string; name: string; input: unknown }
  | { kind: 'tool-result'; id: string; ok: boolean; summary: string }
  | { kind: 'permission-request'; requestId: string; tool: string; input: unknown }
  | { kind: 'result'; text: string; sessionId: string }
  | { kind: 'error'; message: string }
  | { kind: 'exit'; code: number | null };
```

No I/O; unit-tested against fixture stdout streams (including partial/split lines
and malformed lines → skipped).

**2. `lib/liveSession/transcript.ts` — pure**
`reduceTranscript(state, event): TranscriptState`. Folds `SessionEvent`s into the
view model the chat renders: an ordered list of turns (user / assistant) with
inline tool activity, a live `pendingPermission?`, `status` (running/awaiting-
input/awaiting-permission/ended/error), and a tool-use `actionCount` for Byte's
meter. Undefined-safe, never mutates input. Unit-tested.

**3. `lib/liveSession/registry.ts`**
Module-level `Map<buildSessionId, LiveSession>` where `LiveSession = { child,
emitter: EventEmitter, sessionId?, pending: Map<requestId, (d)=>void>, status }`.
Getters/setters + cleanup. Single-user local scope — in-memory is sufficient and
intentionally not persisted.

**4. `lib/liveSession/engine.ts` — I/O**

- `startSession({ buildSessionId, projectDir, openingPrompt, permission })`: spawn
  the `claude` child in `cwd=projectDir`; write the opening prompt to stdin; pipe
  stdout through `parseEvents` → emit on the session emitter; register in the
  registry. Guards: `claude` missing / non-darwin / spawn failure → throw a typed
  error the route turns into the remote fallback.
- `sendTurn(buildSessionId, text)`: write a user-message JSON line to the child's
  stdin (guarded if exited).
- `stopSession(buildSessionId)`: kill child, resolve/deny any pending permissions,
  cleanup registry.
- `resolvePermission(buildSessionId, requestId, decision)`: resolve the parked
  promise (used by the permission route).
- Lifecycle: on child `exit`/`error`, emit and cleanup.

**5. `lib/liveSession/permissionServer.mjs` — P3 only**
A tiny stdio MCP server exposing one tool `codepet_permit`. On call it POSTs the
request to the local app (`/api/build-session/permission/enqueue`) and awaits the
decision (long-poll or hold the HTTP response open), then returns
`{ decision, reason }` to the CLI. Launched by the engine and wired via
`--permission-prompt-tool codepet_permit` + an `--mcp-config` pointing at it. Its
pure request/response mapping is unit-tested; the transport is integration-tested.

**6. API routes — `app/api/build-session/`**

- `POST /start` `{ buildSessionId, projectDir, plan, brief }` → `startSession`;
  returns `{ ok, sessionId }` or `{ ok:false, reason:'remote'|'no-claude', command }`.
- `GET /stream?buildSessionId=…` → SSE; subscribes to the session emitter and
  streams `SessionEvent`s (with a replay of buffered events on connect so a
  reconnect resumes).
- `POST /send` `{ buildSessionId, text }` → `sendTurn`. (P2)
- `POST /stop` `{ buildSessionId }` → `stopSession`.
- `POST /permission` `{ buildSessionId, requestId, decision }` → `resolvePermission`. (P3)
- `POST /permission/enqueue` (localhost, from the MCP server) — parks a pending
  permission, emits a `permission-request` event, holds until resolved. (P3)

All routes are `runtime = 'nodejs'` and local-only; they reject in remote mode.

**7. UI — `DuringStep` rewrite + subcomponents (`components/views/build/`)**

- **Transcript**: user bubbles; assistant text (streamed via deltas); inline tool
  chips (`Read app/x.ts`, `Bash npm test`, …) with collapsible results.
- **Composer** (P2): textarea + Send; disabled while awaiting a permission.
- **Permission card** (P3): shows tool + input, Allow / Deny buttons →
  `/permission`.
- **Byte coaching rail**: budget meter fed by `actionCount` (tool-use count from
  the stream, reusing `budgetState`); the double-check habit; narration reads the
  assistant text directly (Byte can summarize with the existing `narrate`/
  `byteDuringLine` logic). Stop button.
- **States**: connecting, running, awaiting-input, awaiting-permission, ended,
  error (with restart / fall-back-to-Terminal).
- Consumes `reduceTranscript` for its view model; the component stays thin.

### Relationship to existing code

- `armBuildSession` (Terminal open) becomes the **remote/fallback** path. `DuringStep`
  branches on capability: local → in-UI chat (this design); remote → today's
  copy-paste command + hook meter.
- The hook-based live tracking (`codepet-live.mjs` → `/api/track/live`) stays for
  the Terminal path; the in-UI chat reads events straight from stdout, so it does
  not depend on hooks.
- START (plan) and END (recap + notebook) are unchanged; END can read the final
  `result` event and/or the existing git rollup.

## Phases (build order; one spec, three plan cycles)

- **Phase 1 — one-way streaming chat (MVP).** parseEvents + transcript reducer +
  registry + engine.start + `/start` + `/stream` (SSE) + a read-only transcript UI.
  Opening prompt only (no composer yet). Permission mode `acceptEdits`. Proves the
  pipe: "type a brief → watch Claude work in the UI."
- **Phase 2 — two-way.** engine.sendTurn + `/send` + composer; keep the process
  alive across turns; status handling (awaiting-input).
- **Phase 3 — UI permissions.** permissionServer.mjs + `--permission-prompt-tool` +
  `/permission` + `/permission/enqueue` + the Allow/Deny card; replace `acceptEdits`
  with the prompt-tool bridge.

## Error handling

- `claude` not installed / spawn fails / non-darwin non-local → typed error →
  route returns the remote fallback (copy-paste command), UI shows it.
- Child crash/exit mid-session → `exit`/`error` event → UI offers restart.
- SSE disconnect → UI reconnects; server replays buffered events for the session.
- Permission request with no answer within a timeout → auto-deny (safe default),
  surfaced in the transcript.
- stdin write after exit → guarded no-op with an error event.
- Malformed stdout line → skipped by `parseEvents` (never throws).

## Security & safety

- Local-only; the child runs as the user with their own `claude` auth — no new
  credential surface. `.env` secrets are never sent to the browser.
- Until P3, `acceptEdits` auto-approves edits but still blocks Bash/network; P3
  makes every sensitive action an explicit UI decision.
- The permission bridge listens only on localhost and is scoped to a known
  `buildSessionId`; requests for an unknown session are rejected.

## Testing

- `parseEvents.test.ts`: fixture streams → normalized events; partial/split lines;
  malformed lines skipped; each event kind.
- `transcript.test.ts`: event sequences → transcript state; tool chip grouping;
  actionCount; pendingPermission set/clear; status transitions; undefined-safety.
- `registry` + `engine`: lifecycle with a mocked child process (start → emit →
  send → stop → cleanup); sendTurn-after-exit guard.
- Routes: `/start` (local vs remote branch), `/send`, `/stop`, `/permission` with a
  mocked engine.
- permissionServer: request/response mapping unit test; enqueue→resolve→timeout.
- Manual e2e per phase: real `claude` session in a scratch repo (P1 watch, P2
  follow-up, P3 approve/deny).

## Open questions (resolve in planning)

- Exact stdin user-message JSON shape and stdout event shapes vs the installed CLI
  (verify empirically; `parseEvents` is written defensively around it).
- Whether to use `--include-partial-messages` (token-by-token) or whole assistant
  messages for the first cut (P1 can start with whole messages, add deltas later).
- MCP permission transport detail (long-poll vs a held response) — P3 planning.
