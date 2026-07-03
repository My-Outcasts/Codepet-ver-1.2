# Build Coach — Byte narrates Claude Code's responses (DURING step)

**Date:** 2026-07-03
**Status:** Approved, ready for planning

## Problem

The Build Coach's DURING step already streams a live meter of a real Claude Code
session: it counts tool actions and shows recent tool *names* ("Byte sees: Read ·
Edit · Bash"). But the builder never sees **what Claude is actually saying or
doing**, and — critically — never gets nudged when Claude **pauses to ask them a
question** (a permission prompt or an idle wait). A founder watching the meter can
miss that Claude is blocked on them, and the tool-name feed reads as noise rather
than progress.

We want Byte to **re-interpret Claude Code's responses** into short, coach-voice
lines during the build, and to surface clearly when Claude is waiting on the user.

## Goals

- Capture two new live signals from the running session:
  1. **What Claude just said** — the assistant's text at the end of each turn.
  2. **When Claude asks the user back** — permission prompts / idle waits.
- Have **Byte re-interpret** these into its own short lines (not raw Claude text).
- Keep the builder's raw code/content **private**: raw assistant text never leaves
  the local machine.
- Never block, slow, or break the Claude Code session.

## Non-goals

- No full transcript / scrolling chat log in the UI (Byte summarizes, one line).
- No AI/LLM call to summarize (would cost tokens + latency — ironic against the
  app's "be token-thrifty" message). Narration is a deterministic local heuristic.
- No change to the END-step rollup (`/api/track`, SessionEnd) or the Summary.

## Key decisions (from brainstorming)

- **Signals tracked:** assistant text ("what Claude said") + Claude's questions
  back to the user ("Claude asks you back").
- **Presentation:** Byte *re-interprets* — no raw Claude text shown in the UI.
- **Where processing happens:** **locally, in the hook, with a heuristic.** Raw
  text is narrated on the user's machine; only Byte's short line (~120 chars) is
  POSTed. This is the privacy-preserving choice.
- **Language:** Byte narrates in **English**, matching all existing Byte UI copy.

## Architecture

Reuses the existing live pipeline end-to-end — no new endpoint, no new Firestore
collection:

```
codepet-live.mjs (local hook)
  ├─ SessionStart → start           (unchanged)
  ├─ PostToolUse  → tool  (+name)   (unchanged)
  ├─ Stop         → turn  (+ say)   ← NEW: read transcript, narrate() locally
  └─ Notification → ask   (+ ask)   ← NEW hook event
        → POST LiveEvent → /api/track/live
              → reduceLive() folds into liveBuilds/{buildSessionId}
                    → subscribeLiveBuild → DuringStep renders Byte's bubble
```

### 1. Narration module — `toolkit/hooks/narrate.mjs` (+ `narrate.test.mjs`)

A pure, framework-free ESM module unit-tested via `node --test`. It lives **beside
the hook in `toolkit/hooks/`** (not `lib/installer/`) so the hook's relative
`import './narrate.mjs'` resolves both in the repo and after install (the installer
copies both files into the same `~/.claude/codepet/` directory). `node --test` is
pointed at `toolkit/hooks/` in addition to `lib/installer/`.

It exports two pure functions:

```js
/** Concatenate the LAST assistant message's text blocks from a transcript JSONL
 *  string. Accepts both observed entry shapes. '' when none/unparseable. No I/O. */
export function extractLastAssistantText(jsonl)

/** Turn Claude's raw assistant text (and, as fallback, the active tool name)
 *  into one short Byte-voice line. Deterministic; total (never throws); no I/O. */
export function narrate(text, toolName)
```

Behavior — classify intent, then speak as Byte; only fall back to a cleaned
snippet when nothing matches:

| Signal in text (case-insensitive) | Byte says |
|---|---|
| `test` | `Claude's running tests — nice, playing it safe 🧪` |
| `fix` / `bug` / `error` | `Claude's patching something up 🔧` |
| `add` / `create` / `implement` / `build` | `Claude's building a new piece ✨` |
| `refactor` / `clean` / `tidy` | `Claude's tidying up the code 🧹` |
| empty text (turn was all tool calls) | derive from `toolName` (e.g. `Byte sees Claude working with Edit…`); if no tool, `Claude's thinking it through…` |
| anything else | `Byte sees Claude: "<first sentence, markdown-stripped, ≤120 chars>"` |

Cleaning rules for the fallback snippet: strip markdown emphasis/backticks/headers,
collapse whitespace, take the first sentence, hard-cap length. Output is always a
short single line safe to POST.

**Why a separate installed file, not inline in the hook:** the hook currently
inlines a tiny `kindFor`, accepting duplication for a 3-line map. Narration +
transcript parsing are larger and worth unit-testing, so they live in their own
`.mjs`. It is **installed as a sibling** of the hook in
`~/.claude/codepet/narrate.mjs`; the hook imports it by relative path
(`import { narrate, extractLastAssistantText } from './narrate.mjs'`). Keeping the
source in `toolkit/hooks/` (beside the hook) means the same relative import works
both in the repo and after install.

### 2. Live hook — `toolkit/hooks/codepet-live.mjs`

- Extend `kindFor`: `Notification → 'ask'` (in addition to the existing three).
- On **`Stop`**: read `input.transcript_path` (JSONL). Guarded, best-effort:
  - `say = narrate(extractLastAssistantText(fs.readFileSync(transcript_path)))`.
    Both parsing (`extractLastAssistantText`) and narration (`narrate`) come from
    `./narrate.mjs`, so the hook itself only does the file read.
  - If the transcript read/parse fails, `say` is omitted — the `turn` event still
    fires (counting behavior unchanged).
- On **`Notification`**: emit `kind: 'ask'` with `ask` = a Byte reminder derived
  from `input.message`. We rely only on the `message` field (stable), not on
  `notification_type`. Example: `ask = "Claude's waiting on you — hop back to the
  Terminal and answer 🙋"`. (The raw `input.message` is not forwarded; Byte's line
  is fixed/templated, so nothing sensitive leaves the machine.)
- Everything stays guarded with try/catch, the POST keeps its short timeout, and
  the process always `exit 0`.

### 3. Reducer & wire format — `lib/liveBuild.ts` (+ `liveBuild.test.ts`)

- `LiveEvent`: add optional `say?: string` (carried on `kind: 'turn'`) and a new
  `kind: 'ask'` carrying `ask?: string`. Add `'ask'` to `KINDS`.
- `LiveState`: add `lastSay?: string` and `pendingAsk?: string`.
- `reduceLive`:
  - `turn` → also set `lastSay` when `event.say` is present (else keep prior).
  - `ask` → set `pendingAsk = event.ask`; does not reset counters.
  - `tool` → **clear `pendingAsk`** (Claude proceeded ⇒ the user has answered),
    in addition to the existing action count / recentTools update.
  - `start` → `initialLive` (already clears everything; `lastSay`/`pendingAsk`
    absent = clean).
- `eventKindFor`: `case 'Notification': return 'ask'`.
- `sanitizeLiveEvent`: accept and length-cap `say`/`ask` (e.g. ≤160 chars),
  attached only to their respective kinds; unknown/oversize values dropped safely.

### 4. UI — `components/views/BuildCoachView.tsx` (`DuringStep`)

The Byte bubble's `say`/`mood` become derived, in priority order:

1. `live.pendingAsk` → `mood: 'worried'`, say the pending-ask line (the highlighted
   "Claude is asking you" case). This is the standout state the user asked for.
2. else `live.lastSay` → say Byte's latest narrated line, `mood` from budget state.
3. else → existing default copy.

The budget `warn` mood still wins for the meter color; the ask state only overrides
the *bubble's* mood/line. The `recentTools` context line stays unchanged.

### 5. Installer — `lib/installer/tracking.mjs` (+ `tracking.test.mjs`)

- Add `'Notification'` to `LIVE_HOOK_EVENTS`.
- Add a `narrateSource(cwd)` helper mirroring `liveSource` →
  `toolkit/hooks/narrate.mjs`.
- In `installTracking`, copy `narrate.mjs` into `~/.claude/codepet/narrate.mjs`
  alongside the live hook, and return its path.
- Update `tracking.test.mjs` to assert the `Notification` hook is registered and
  `narrate.mjs` is written next to the hook.
- Broaden the `test:installer` npm script to `node --test lib/installer/
  toolkit/hooks/` so `narrate.test.mjs` runs in CI.

## Data flow example

1. Claude finishes a turn saying "I'll add the login form and wire it to auth."
   → `Stop` hook reads transcript → `narrate()` matches "add" →
   `say: "Claude's building a new piece ✨"` → POST `turn` event.
2. `reduceLive` sets `lastSay`. Subscription pushes it; Byte's bubble updates.
3. Claude requests permission to run `npm install` → `Notification` hook →
   `ask: "Claude's waiting on you — hop back to the Terminal and answer 🙋"` →
   `reduceLive` sets `pendingAsk` → Byte turns worried and surfaces it.
4. User answers; Claude runs a tool → `PostToolUse` → `tool` event clears
   `pendingAsk` → Byte returns to narrating progress.

## Privacy

Raw assistant text and raw notification messages are processed **only on the
user's machine** inside the hook. The wire carries only Byte's short, mostly
templated line (the single fallback branch may include a ≤120-char first-sentence
snippet). This is strictly more than the current design sends (tool names only), so
the snippet fallback is the one place a fragment of Claude's text could leave the
machine — length-capped and markdown-stripped. Acceptable given the user opted into
local-heuristic processing; revisit if stricter redaction is wanted.

## Failure & safety

- Transcript unreadable / malformed → `say` omitted, turn still counts.
- `narrate()` is total (never throws): any input yields a string.
- Notification hook failure → no ask surfaced; build unaffected.
- All hook I/O guarded; short POST timeout; process always `exit 0`.
- Server `sanitizeLiveEvent` rejects/caps bad `say`/`ask` before the transaction.

## Testing

- `narrate.test.mjs`: each intent branch, empty-text→tool fallback, markdown
  stripping, length cap, no-throw on odd input.
- `liveBuild.test.ts`: `turn` sets `lastSay`; `ask` sets `pendingAsk`; `tool`
  clears `pendingAsk`; `start` resets; `eventKindFor('Notification')`;
  `sanitizeLiveEvent` caps/accepts `say`/`ask`.
- `tracking.test.mjs`: `Notification` registered; `narrate.mjs` installed beside
  the hook.
- Manual: arm a build, run a real session, confirm Byte narrates turns and flips
  to the ask state on a permission prompt.

## Out of scope / future

- Richer paraphrase via a local model.
- A short ring buffer of recent Byte lines (currently only `lastSay`) — deferred;
  easy to add later without wire changes.
- Distinguishing permission vs idle in the ask copy (would use `notification_type`,
  which we chose not to depend on yet).
