# Claude Code activity tracking → Summary (MVP)

**Date:** 2026-07-01
**Status:** Approved (mechanism + scope), implementing MVP

## Goal

Replace the Summary screen's mock numbers with **real data from the user's Claude
Code activity**. The user picked three signals: **activity** (sessions / tasks),
**code output** (lines / commits / PRs), and **estimated time saved**. Cost/tokens
were intentionally excluded.

## Why hooks (not MCP, not OTEL) — verified

- **MCP is the wrong tool.** MCP is request/response: Claude *calls* tools on a
  server; the server can't passively collect Claude's telemetry. (Channels are a
  research-preview inbound-message feature, not telemetry.)
- **OpenTelemetry** exports exact metrics but requires standing up an OTLP
  (protobuf/gRPC) receiver + cumulative-counter aggregation — heavy for a
  Next.js/Firebase app, and its unique value (cost/tokens) wasn't requested.
- **Hooks win for this MVP.** Claude Code supports a `SessionEnd` hook that can run
  a local command. The three chosen signals (sessions, commits, PRs, lines) are all
  derivable from **git** at session end, and a hook can POST a rich JSON event
  (including real commit subjects → real "Recent wins") to a hosted endpoint.

Refs: monitoring-usage, hooks, mcp docs at code.claude.com.

## Architecture

```
 user's machine                         Codepet (hosted)
 ┌───────────────────────┐              ┌──────────────────────────┐
 │ Claude Code           │              │ /api/track  (server)     │
 │  SessionEnd hook       │  HTTP POST   │  - verify ingestToken    │
 │  → codepet-track.mjs   │ ───────────▶ │  - append TrackEvent     │
 │    (reads git stats)   │   JSON       │    to Firestore          │
 └───────────────────────┘              └──────────┬───────────────┘
        installed into ~/.claude by                │ companies/{id}/trackEvents
        Codepet's installer (already writes there) │
                                          ┌─────────▼───────────────┐
                                          │ store (client) reads     │
                                          │ recent events, aggregates│
                                          │ via lib/tracking.ts →    │
                                          │ SummaryView (real numbers)│
                                          └──────────────────────────┘
```

**Web app can't read local Claude Code data** — so the local machine must *push*.
The installer already writes to `~/.claude`, giving us the seam to drop the hook.

## Data model

`TrackEvent` (one per session end):

```ts
interface TrackEvent {
  id: string;            // server-assigned
  ts: Millis;            // session end time
  sessionId: string;
  cwd?: string;
  repo?: string;         // basename of cwd
  branch?: string;
  commits: number;       // commits during the session
  prs: number;           // PRs opened during the session (gh, best-effort)
  linesAdded: number;
  linesRemoved: number;
  wins: string[];        // commit subjects (→ Recent wins)
}
```

Firestore: `companies/{companyId}/trackEvents/{eventId}`.
Company doc gains `ingestToken: string` (random, minted server-side).

## Aggregation — `lib/tracking.ts` (pure, unit-tested)

```ts
aggregateTracking(events, sinceMs?) => {
  sessions: number;
  commits: number;
  prs: number;
  linesChanged: number;     // added + removed
  hoursSaved: number;       // estimate, see below
  recentWins: { title: string; repo?: string; ts: number }[];  // newest first, deduped
}
```

`estimateHoursSaved` — a transparent heuristic (labelled "est." in the UI), not a
measurement:

```
hoursSaved = round( linesChanged / 150  +  commits * 0.4  +  sessions * 0.3 )
```

Constants live at the top of the module so they're easy to tune. The point is a
*directionally honest* proxy, clearly marked as an estimate.

## Ingest endpoint — `app/api/track/route.ts`

- `POST` body: `{ companyId, token, event }`.
- Validate shape; look up `companies/{companyId}` via Admin SDK; require
  `token === doc.ingestToken`; else 401.
- Append the event (server-stamped `id`, `ts`) to `trackEvents`.
- Admin SDK write requires a service account (`FIREBASE_CLIENT_EMAIL` +
  `FIREBASE_PRIVATE_KEY`). Documented as a deploy dependency.

## Read path

- `companyData.loadTrackingSummary(companyId)` — client SDK reads the most recent
  ~200 `trackEvents` (last 30 days), runs `aggregateTracking`, returns the summary.
- `store` hydrates `tracking` alongside company data; exposes it via `useApp()`.
- `firestore.rules`: company members may **read** `trackEvents`; **no client
  writes** (only the Admin-SDK route writes).

## Summary UI changes

`hasTracking = tracking && tracking.sessions > 0`. When true, prefer real data;
otherwise keep the current DEPTS/library-derived view (graceful fallback — a brand
new user with no sessions still sees a sensible screen).

- **Hero sub:** `{sessions} sessions · {commits} commits · ~{hoursSaved}h saved`.
- **Stat chips:** `sessions` · `commits` · `PRs` (fallback: departments · tasks done
  · shipped).
- **Recent wins:** real commit subjects (fallback: library items, then empty state).
- **Autopilot bar** and **You are here** stay DEPTS/roadmap-derived (orthogonal —
  they're about pending approvals and roadmap stage, not Claude Code output).

## Local hook install

- `toolkit/hooks/codepet-track.mjs` — Node script run by the `SessionEnd` hook.
  Reads the hook JSON on stdin (`session_id`, `cwd`), collects git stats
  (`git log`, `git diff --shortstat`), reads config (companyId, token, apiUrl) from
  `~/.claude/codepet/track.json`, and POSTs the event. Fails silently (never blocks
  Claude Code).
- `lib/installer/settings.mjs` — pure `mergeHook(settings, hookDef)` that adds the
  hook to `settings.json` without clobbering existing hooks (unit-tested).
- Installer wiring writes the script + merges the hook + writes `track.json` with the
  company's `ingestToken`. (Runs in Codepet's local installer context, which already
  knows the signed-in company.)

## Scope / honesty

- Buildable + unit-tested here: `lib/tracking.ts`, `lib/installer/settings.mjs`,
  payload validation.
- Written + typechecked but **needs real-machine e2e** (a real Claude Code session +
  service-account Firestore): the hook round-trip and Admin writes. This environment
  can't exercise those.

## Out of scope (YAGNI for MVP)

- OTEL / cost / tokens (add later if needed).
- Per-task granularity beyond session-end rollups.
- Backfill of historical sessions.
- Multi-repo attribution beyond `repo`/`branch` labels.

## Testing

- `vitest`: `lib/tracking.test.ts`, `lib/installer/settings.test.mjs`.
- `yarn typecheck` + `eslint` + `prettier` clean.
- Dev server compiles; Summary renders with fallback when `tracking` is empty.
