# Build Coach — Live Session ("Cùng làm" đồng hành thật) — Design

**Date:** 2026-07-02
**Status:** Draft (design), pending user review → implementation plan
**Supersedes the mocked DURING of:** `2026-07-02-build-coach-view-design.md`
**Builds on:** `2026-07-01-claude-code-tracking-design.md` (SessionEnd tracker, installer seam, `/api/track`)

## Why this exists (differentiation)

The first Build Coach view was an honest _simulation_: a drag slider, a mostly-static
plan, nothing wired to real work. The obvious user question was "why not just open
Claude Code?" — and it was fair, because the sim doesn't _do_ anything Claude Code
doesn't.

This iteration answers that question. **Claude Code is the engine; Codepet is the
coach that brackets one real session end-to-end and closes a loop Claude Code never
does for the user** — plan → build (real) → reflect + form habits + remember. The
"Cùng làm" flow (START · DURING · END) now wraps **exactly one real Claude Code
session**, keyed by a `buildSessionId`, and DURING shows **real activity in real
time**.

Target user: the non-technical / vibe-coder who finds a blank terminal intimidating,
burns budget without noticing, and doesn't build good habits. Byte accompanies them.

## Decisions locked in brainstorming

1. **Accompaniment level: passive/observe only.** DURING watches the real session
   live and reacts (meter, mood, activity feed). It does **not** inject context or
   gate tool calls. (Active intervention via `UserPromptSubmit`/`PreToolUse` is a
   verified-possible _future_ step, explicitly out of scope here.)
2. **Session launch: Codepet auto-opens a new Terminal.** In local mode, START opens
   a Terminal window running `claude` with the plan preloaded. **macOS-first**
   (`osascript`); Windows/Linux deferred.
3. **Budget unit = number of actions (tool-uses).** Not tokens (hooks can't get real
   tokens cheaply — verified; see below), not diff lines. Intuitive for beginners
   ("Byte đã làm 12 việc").
4. **One spec for the whole loop.** Embedded terminal (Electron/Tauri + node-pty) and
   active intervention are deferred to later specs.

## Verified platform facts (Claude Code hooks)

Checked against code.claude.com docs (via claude-code-guide):

- Hooks fire **throughout** a session, not just at end: `SessionStart`,
  `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop` (each turn), `SessionEnd`,
  etc. Real-time observability is therefore possible.
- Hook stdin JSON includes `session_id`, `cwd`, `transcript_path`, `hook_event_name`;
  `PostToolUse` adds `tool_name`, `tool_input`, `tool_output`, `tool_use_id`.
- **Real token usage is NOT cheaply available to a hook** — the transcript does not
  expose per-message `usage`; exact tokens require standing up OpenTelemetry. This is
  why the budget is measured in **actions**, not tokens (and matches the earlier
  tracking spec, which also excluded tokens).
- **Hooks run synchronously and block Claude Code** (UserPromptSubmit timeout 30s,
  others up to 10min). Non-2xx / timeout = _non-blocking_ error, session continues.
  → The live emitter must POST fast and never wait on slow work.
- `type: "http"` hooks can POST directly to an endpoint. We keep a thin local Node
  script instead (parity with the existing `codepet-track.mjs`, and it can read the
  arm-file for the `buildSessionId`).

## The one-session loop

```
 START (Codepet)                DURING (Codepet, live)            END (Codepet)
 ─────────────────              ───────────────────────           ─────────────────
 plan via /api/build-plan       onSnapshot liveBuilds/{id}        SessionEnd → advance
 → write current-build.json     meter = actions/target            real recap + checklist
 → open Terminal: claude "…"    Byte mood via budgetState()       unlock habit, write memory
        │                       activity feed, commits                     ▲
        │                              ▲                                    │
        ▼                              │ POST /api/track/live               │ rolled into
 ~/.claude/codepet/          SessionStart·PostToolUse·Stop        trackEvents (existing)
 current-build.json  ───────▶ codepet-live.mjs (reads arm-file) ─────────────┘
   {buildSessionId, plan,     tags every event with buildSessionId
    doneLooks, config}
```

Everything between "open Terminal" and `SessionEnd` is **one real Claude Code
session**, correlated by `buildSessionId`.

## Component ①: START → arm the session

- **Inputs + plan:** unchanged (`StartStep`, `/api/build-plan`). Plan now also returns
  `budgetActions` (expected tool-use count) — see schema change below.
- **New: `armBuildSession` (server action, local mode).** On "Bắt đầu build":
  1. Client mints a `buildSessionId` (random) and picks a project dir (reuse
     `lib/projects.ts` project list).
  2. Server action writes `~/.claude/codepet/current-build.json`:
     ```ts
     interface CurrentBuild {
       buildSessionId: string;
       projectDir: string;
       plan: BytePlan; // title, steps, budgetActions
       audience: string;
       doneLooks: string;
       companyId: string;
       token: string; // ingest token (reuse tracking's)
       apiUrl: string;
       startedAt: Millis;
     }
     ```
  3. Opens Terminal (macOS): `osascript -e 'tell app "Terminal" to do script
"cd <projectDir> && claude \"<plan-as-opening-prompt>\""'`. The opening prompt is
     the plan rendered as a short instruction so the session starts on-scope.
- **Remote/web fallback:** no fs, no spawn. Show a copy-paste block (the `cd … &&
claude "…"` line) + a note that live meter needs local mode; the flow still works
  via the SessionEnd summary.
- **Pure helper (unit-tested):** `buildOpeningPrompt(plan, audience, doneLooks)` →
  the string handed to `claude`. And `terminalCommand(projectDir, prompt)` →
  the `cd … && claude …` string (quote-escaped), tested without spawning.

## Component ②: live activity emitter (hooks)

- **Extend installed hooks** beyond `SessionEnd`. Add `SessionStart`, `PostToolUse`,
  `Stop`, all pointing at `toolkit/hooks/codepet-live.mjs`. `mergeHook` in
  `lib/installer/settings.mjs` already adds hooks without clobbering — extend it to
  merge the set (unit-tested).
- **`codepet-live.mjs`** (Node, run by the hook):
  - Reads hook JSON on stdin (`session_id`, `hook_event_name`, `tool_name`, `cwd`).
  - Reads `~/.claude/codepet/current-build.json` for `buildSessionId` + config. If the
    file is missing or its `buildSessionId` is stale, **no-op** (a normal session with
    no active build must not emit).
  - POSTs a `LiveEvent` to `apiUrl + /api/track/live`, **best-effort, fast**: short
    timeout, swallow errors, never block Claude Code.
  - On `SessionStart` → `kind:'start'`; `PostToolUse` → `kind:'tool'` (+`tool`);
    `Stop` → `kind:'turn'`.
- The **existing `codepet-track.mjs` (`SessionEnd`) is unchanged** and remains the
  authoritative session rollup; the live emitter is additive and lossy-by-design.

```ts
interface LiveEvent {
  buildSessionId: string;
  sessionId: string;
  kind: 'start' | 'tool' | 'turn';
  tool?: string; // for kind:'tool'
  ts: Millis;
}
```

## Component ③: live endpoint + Firestore

- **`app/api/track/live/route.ts`** (Admin SDK). `POST { companyId, token, event }`:
  - Validate shape; verify `token === companies/{companyId}.ingestToken` (reuse the
    `/api/track` auth pattern); else 401.
  - Upsert `companies/{companyId}/liveBuilds/{buildSessionId}`:
    - `kind:'start'` → create/reset `{ actionCount:0, turns:0, recentTools:[],
startedAt, lastTs, ended:false }`.
    - `kind:'tool'` → `actionCount++`, push `tool` into `recentTools` (cap last ~8),
      `lastTs`.
    - `kind:'turn'` → `turns++`, `lastTs`.
  - **Idempotency-lite:** events are increments; occasional loss is acceptable (the
    meter is a directional proxy, not an audit). No dedup needed for MVP.
- **Session end still flows through the existing `SessionEnd` tracker** → a
  `trackEvent` (commits, diff, wins). The live doc gets `ended:true` when its matching
  `trackEvent` arrives (match by `sessionId`) so DURING knows to advance to END.
- **`firestore.rules`:** company members may **read** `liveBuilds`; **no client
  writes** (Admin route only) — same posture as `trackEvents`.

## Component ④: DURING (live meter, observe-only)

- Replace the slider with a **live meter** bound to `liveBuilds/{buildSessionId}` via
  `onSnapshot` (client SDK, same read auth as tracking).
- **Reuse `budgetState()` unchanged** (`lib/buildCoach.ts`, `DANGER_PCT = 80`):
  `pct = min(100, round(actionCount / plan.budgetActions * 100))`. ≥80 → Byte
  "lo quá 😰", meter amber, and the "Kiểm tra kỹ" reminder **card is revealed**
  (latches once shown) — existing behaviour, now driven by real data. Revealing the
  card ≠ awarding the habit; the award happens in END (below).
- **Activity feed:** render `recentTools` as Byte's narration ("Byte thấy: sửa
  file, chạy test…"). Purely presentational.
- **Waiting / fallback states:**
  - Local mode, no events yet → "Đang chờ Byte thấy phiên của bạn…".
  - Remote/web (no live) → static "mở terminal chạy `claude`" card; skip straight to
    END-from-SessionEnd when the rollup lands (if the app is open) or show the recap
    on next load.

## Component ⑤: END (close the loop, real data)

- Triggered when the live doc flips `ended:true` (or the user clicks Next).
- **Real recap grid:** actions used vs `budgetActions`; commits + lines from the
  session's `trackEvent`; the `wins` (commit subjects).
- **Checklist:** one row per `plan.steps`, plus "đối chiếu với _done trông thế nào_"
  (echoes the START `doneLooks` for the user to self-confirm — no AI grading in MVP).
- **Habit award:** "Kiểm tra kỹ" is _awarded as earned_ if `pct` stayed < 100 **and**
  the session produced ≥1 commit (a directional "you finished something without blowing
  budget"). Distinct from the DURING _reveal_ of the reminder card.
- **Memory note (real this time):** "Ghi vào sổ tay" writes a small doc to Firestore
  (`companies/{id}/notebook` or reuse an existing collection) with `{ buildSessionId,
doneLooks, wins, ts }`. Client SDK write, guarded by rules to members.

## Pure logic to isolate + unit-test

Framework-free, no network — tested with Vitest:

- `buildCoach.ts::budgetState(pct)` — **already exists, reused as-is.**
- `plan.ts` — extend `PLAN_SCHEMA` + `BytePlan` with `budgetActions` (integer, e.g.
  5–40); prompt asks for it. Existing `sanitizePlanInput`/`buildPlanPrompt` tests
  extended.
- `liveBuild.ts` (new) — `reduceLive(state, event)`: pure reducer the endpoint uses to
  fold a `LiveEvent` into the stored counters. Tested at boundaries (start resets,
  tool increments + caps `recentTools`, turn increments).
- `armSession.ts` (new) — `buildOpeningPrompt()` and `terminalCommand()` (quote
  escaping) tested; the actual `osascript`/fs spawn is a thin, untested-here shell (see
  honesty note).

## Integration points

- `lib/ai/plan.ts` — add `budgetActions` to `BytePlan`, `PLAN_SCHEMA`, prompt.
- `app/api/build-plan/route.ts` — unchanged wiring (schema-constrained reply).
- `app/actions/` — new `armBuildSession` server action (local-mode fs write + Terminal
  open; remote → returns fallback command).
- `toolkit/hooks/codepet-live.mjs` — new live emitter.
- `lib/installer/settings.mjs` — extend hook merge to include the live hooks.
- Installer wiring — the live hooks install alongside the existing SessionEnd tracker
  (same `~/.claude` seam, same ingest token).
- `app/api/track/live/route.ts` — new endpoint.
- `lib/firebase/*` + `firestore.rules` — `liveBuilds` read rule, notebook write rule.
- `components/views/BuildCoachView.tsx` — DURING rewritten to `onSnapshot`; END reads
  the `trackEvent`; START gains the arm/launch button + project pick.
- `lib/store.tsx` — no new global state required beyond what `useApp()` already exposes
  for tracking; the live subscription is component-local to DURING.

## Modes / honesty

- **Local mode only** gets the full live loop (hooks + Terminal auto-open). Detected
  via `detectCapability().mode === 'local'` (existing).
- **Remote/web** gracefully degrades to: manual launch command + END recap from the
  existing SessionEnd rollup. No live meter. Clearly labelled.
- **macOS-first** for Terminal automation. Windows/Linux show the copy-paste command
  even in local mode (documented limitation).
- **Buildable + unit-tested here:** `reduceLive`, `budgetState` (reused), plan schema,
  `buildOpeningPrompt`/`terminalCommand`, `mergeHook` extension, payload validation.
- **Written + typechecked but needs real-machine e2e:** the hook round-trip, the
  `osascript` Terminal open, and Admin/live Firestore writes. This environment can't
  exercise a real Claude Code session.

## Out of scope (YAGNI / deferred specs)

- Embedded terminal in-app (Electron/Tauri + node-pty) — the "Kiểu B" fully-contained
  window.
- Active intervention: `UserPromptSubmit` context injection, `PreToolUse` gating.
- Real token/cost via OpenTelemetry.
- AI-graded "done" comparison (MVP echoes `doneLooks` for self-check).
- Windows/Linux Terminal auto-open.
- Multi-session / concurrent builds per company (one active `current-build.json`).

## Testing

- **Vitest:** `liveBuild.test.ts` (reducer boundaries), `plan.test.ts` (budgetActions
  in schema + prompt), `armSession.test.ts` (prompt build + command escaping),
  `settings.test.mjs` (live hooks merged without clobber), `/api/track/live` payload
  validation. `budgetState` boundary tests already exist.
- **Manual (real machine):** local install → START opens Terminal with `claude`
  preloaded → do a few edits/commits → DURING meter climbs, Byte flips at 80%,
  activity feed updates → end session → END shows real commits + unlocks habit + writes
  the note. Remote mode → verify fallback path.

## Open questions (non-blocking; defaults chosen)

- **Project pick at START:** default to reusing `lib/projects.ts` scanned list; if none,
  fall back to a manual path input.
- **Notebook collection:** default new `companies/{id}/notebook`; revisit if an
  existing notes collection already fits.
- **`ended` correlation:** matching the live doc to its `trackEvent` by `sessionId`
  assumes the SessionEnd tracker and live emitter see the same `session_id` (they do —
  both read the hook stdin). Documented assumption.
