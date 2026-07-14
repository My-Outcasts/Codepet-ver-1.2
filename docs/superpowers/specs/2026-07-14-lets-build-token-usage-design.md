# Let's build — token usage visibility (all users)

**Date:** 2026-07-14
**Goal:** Every user sees how many tokens a Let's build session consumed ("this build:
~X tokens"), plus today's total on a local app ("today: ~Y"), so they can manage token
spend. Works local (direct transcript read) and remote/Vercel (the session self-reports its
token count, no toolkit install), for both demo and real builds.

Decided in brainstorming: "remaining subscription tokens" doesn't exist (Claude Pro/Max are
rate-limited, not token-metered) — dropped. We show **tokens spent**.

## Current state (grounded)

- `lib/liveSession/parseEvents.ts` parses `claude` stream-json into `SessionEvent`s; an
  `assistant` line's raw object is `obj.message` — Claude puts **`usage`** there
  (`{ input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens }`),
  currently ignored.
- `reduceTranscript` (`lib/liveSession/transcript.ts`) folds events into `TranscriptState`;
  `liveFromTranscript` (`lib/liveSession/liveFromTranscript.ts`) projects it onto `LiveState`
  (the DURING meter + END recap read `buildLive`).
- Remote builds run via a copy-paste command; `armBuild`'s remote branches set
  `buildLaunchCommand` (`demoTerminalCommand(...)` for demo, `terminalCommand(dir, prompt)`
  for real). The store subscribes `liveBuilds/{buildSessionId}` (`buildLive`) in **all**
  remote mode. `/api/track/demo-recap` writes `liveBuilds/{buildSessionId}.recap` (from the
  demo self-report feature).

## Target design

### A. Local per-build tokens (direct, exact)
1. `parseEvents.ts`: add `{ kind: 'usage'; tokens: number }` to `SessionEvent`. In the
   `assistant` branch, if `obj.message.usage` is an object, emit one usage event with
   `tokens = input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens`
   (each coerced via `Number(...) || 0`).
2. `transcript.ts`: add `tokens: number` to `TranscriptState` (default 0 in `initialTranscript`);
   `reduceTranscript` handles `'usage'` → `{ ...state, tokens: state.tokens + event.tokens }`.
3. `liveFromTranscript.ts`: set `out.tokens = t.tokens`.
4. `lib/liveBuild.ts`: add `tokens?: number` to `LiveState`.

This makes `buildLive.tokens` update live in local mode.

### B. Remote per-build tokens (self-report, best-effort, no install)
Add a shared `tokenReportSuffix(report: { apiUrl; companyId; buildSessionId; token }): string`
in `lib/armSession.ts` — a shell segment run after `claude`:
- Find the session's transcript (newest recently-modified jsonl):
  `TF=$(find ~/.claude/projects -name '*.jsonl' -newermt '-30 minutes' 2>/dev/null | xargs ls -t 2>/dev/null | head -1)`
- Sum tokens with a python one-liner (best-effort, `|| echo 0`):
  `tokens=$(python3 -c "import json,sys;t=0
  ...sum message.usage fields per line, ignore parse errors..." "$TF" 2>/dev/null || echo 0)`
- POST to `/api/track/demo-recap` with `{ companyId, token, buildSessionId, tokens }`
  (`curl -s … >/dev/null 2>&1`, ids/token/apiUrl baked at build time, `tokens` shell-substituted).
Append it in **both** remote build paths in `armBuild`: inside `demoTerminalCommand` (which
already self-reports commits/files — add tokens to the same curl or a second curl), and in the
non-demo remote branch by appending `tokenReportSuffix(report)` to `terminalCommand(dir, prompt)`
(the store has `companyId`, `id`, `token`, `window.location.origin` in scope).

### C. Endpoint accepts tokens
Extend `DemoRecap` (`lib/liveBuild.ts`) to `{ commits: number; filesChanged: number; tokens: number }`
and `sanitizeDemoRecap` to clamp `tokens` (floored, ≥0, capped e.g. 2_000_000_000). The endpoint
already writes `{ recap }` with `{ merge: true }`, so a tokens-only POST merges fine (missing
commits/files default to 0 via the sanitizer — but keep them optional-safe: the sanitizer should
carry through only the fields present, or default absent numbers to 0; a real build that posts
only tokens must not zero a prior commits value → **write only the keys present** in the body).

### D. Today's total (ccusage, local only)
New server action `getTodayTokens(): Promise<number | null>` (`app/actions/`) — spawns
`npx -y ccusage@latest daily --since <yyyymmdd> --json`, parses `totals.totalTokens`, returns it;
returns `null` on any error or when not on a local machine. (Best-effort; slow first run.)

### E. UI (build view)
In `BuildCoachView`:
- **DURING** (`DuringStep`): a small line under the meter — `🔢 This build ~{fmt(live.tokens)}`
  (only when `live?.tokens` present) `· Today ~{fmt(today)}` (only when the ccusage action
  returned a number).
- **END** (`EndStep`): the same "this build" figure, sourced from `buildLive.tokens` (local) or
  `recap.tokens` (remote self-report) — pass it in like `recap`.
- `fmt`: compact (`28K`, `26.5M`).
- Fetch `getTodayTokens()` on entering the build view; refresh every ~60s while in DURING.

## Data flow
Local: `claude` stdout → parseEvents (usage) → reduceTranscript.tokens → liveFromTranscript →
`buildLive.tokens` → UI. Remote: command sums the transcript → POST → `liveBuilds/{id}.recap.tokens`
→ store's `subscribeLiveBuild` → `buildLive.recap.tokens` → UI. Today's total: ccusage server
action (local).

## Out of scope
- "Remaining" subscription tokens (impossible).
- Today's total on remote/Vercel (ccusage can't run there).
- Live DURING token stream for remote (self-report lands at session end).

## Security / robustness notes
- Same ingest-token model as the demo-recap endpoint (token in the command; internal use).
- The remote transcript-sum is **best-effort**: picks the newest jsonl, so a concurrent
  session could skew it; parse errors degrade to 0. Local is exact.

## Success criteria
- Local build: "this build" tokens tick up live and appear in the recap; "today" shows the
  ccusage total.
- Remote build (demo or real): the recap shows a real "this build" token figure with no
  toolkit install; "today" is hidden/absent remotely.
- Endpoint clamps tokens and never zeroes prior recap fields on a tokens-only POST.
- `npm run typecheck`, `npm run lint` (no new errors), `npm test` (parseEvents / reduceTranscript /
  liveFromTranscript / sanitizeDemoRecap tests updated) pass.
