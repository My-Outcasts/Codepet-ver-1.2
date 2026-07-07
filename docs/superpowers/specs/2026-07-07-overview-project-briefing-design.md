# Overview first-run — byte's project briefing (analysis + map key)

**Date:** 2026-07-07
**Scope:** The Overview first-run intro (`OverviewIntro`) + a new one-time,
persisted, brief-grounded "project analysis" byte generates for each company. The
spotlight hand-off, beacon, breadcrumb, and map/graph are unchanged.
**Status:** Design approved (brainstorm), ready for implementation plan.

## Problem

The Overview's first-run intro teaches only two things — "byte always keeps one move
lit" and (on reopen) what the colors mean. A first-time founder still doesn't
**understand their own project on the map**: what the center is, why _these_
departments exist, where they are in the journey, and — most importantly — byte never
gives an **overall read of their project** before pointing at the next move. The user's
words: it's "still not enough to fully understand their project," and "there also needs
to be an overall analysis of the user's project/product before telling them what they
need to prepare next."

Goal: on first run, byte opens with a real, personalized **read of the founder's
project**, ties it to how the map is laid out, and only then hands off to the lit next
move — reusing today's fly-to-beacon spotlight unchanged.

## Approach (chosen from brainstorm)

Three decisions were locked during brainstorm:

1. **Core gap = "how it maps to MY company," preceded by an overall project analysis.**
2. **Analysis source = a fresh live analysis** (one `claude-opus-4-8` call), generated
   **once** and **persisted** so it never re-runs.
3. **Delivery shape = one enriched briefing panel → the existing spotlight** (not a
   multi-step tour, not a standalone report). The panel carries byte's analysis (as
   labeled rows — the "structured read" layout) plus a compact "how to read this map"
   key, then the unchanged **"Show me my next move ▸"** CTA flies to the beacon.

Rejected: a multi-step guided coach-mark tour (more intrusive than the founder wanted);
a derived/templated analysis (the founder explicitly chose the richer live read); a
standalone "Your project" report panel (less of an in-context first-run read).

## The project analysis (content contract)

byte produces a tight, brief-grounded read with exactly these five fields — the
"structured read" the founder approved. All are short plain-text strings (rendered as
text, escaped — byte never emits markup here):

| Field      | What it holds                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| `building` | What they're building **and who it's for**, in one or two sentences.                                       |
| `stage`    | Where they are right now (their stage + an honest read of momentum).                                       |
| `edge`     | Their apparent advantage / what's working.                                                                 |
| `watchOut` | The main risk or gap to watch at this stage.                                                               |
| `focusNow` | What to focus on next — **names the departments byte set up and why**, connecting the analysis to the map. |

**Grounding / anti-fabrication (hard requirement):** the analysis is built only from the
founder's real brief (`briefToContext`, the same server-loaded brief `scaffold` and
`run-task` use). byte must not invent traction, numbers, or facts the brief doesn't
support; when the brief is thin, byte stays honest and general (e.g. "you haven't told
me your traction yet — worth pinning down") rather than fabricating. This mirrors the
existing `BYTE_SYSTEM` grounding used by `personalize`/`scaffold`.

## Generation & persistence (the one live call)

Mirror the existing one-time server passes (`/api/personalize`, `/api/scaffold`):

- **New route `POST /api/project-analysis`** (`runtime = 'nodejs'`): auth-gated —
  verifies the Firebase ID token (`verifyIdToken`), rejects missing/invalid with 401.
  Loads the brief **server-side by the verified uid** (`loadServerBrief(uid, idToken)`),
  falls back to a client-passed brief only if the read hasn't settled. Calls
  `generateJson` with the analysis JSON schema and `onUsage: usageSink(uid, idToken,
'project-analysis')` — so the spend **counts toward the per-user daily usage total**,
  exactly like `personalize`/`scaffold`. Like those one-time passes (and unlike
  `run-task`/`chat`), it does **not** call `enforceDailyLimit`/return 429 — a one-time
  first-run read shouldn't be blocked, and it can't be spammed (guarded one-time). No
  brief at all ⇒ return an empty object so the client keeps the fallback intro. Errors
  return via `aiErrorResponse`.
- **One-time & persisted:** on success the client persists the analysis to
  `companies/{uid}.projectAnalysis` and stamps `companies/{uid}.analyzedAt` (exactly
  like `personalizedAt`). Hydrated on load, so it never regenerates and re-opening the
  briefing costs nothing.
- **Single idempotent trigger — `ensureProjectAnalysis()` in the store.** Called from
  `OverviewView` when the first-run intro is about to show. It is a no-op if an analysis
  is already present (persisted or in-memory) or a call is already in flight; otherwise
  it sets a `loading` flag, POSTs the route, and on success stores + persists the
  result. Placing the trigger in the store (not in the onboarding path) covers **both**
  brand-new onboards **and** accounts that onboarded before this feature. Best-effort:
  any failure clears `loading` and leaves the analysis absent → the panel falls back to
  the map-only intro. It never blocks first-run.

## The enriched briefing panel (`OverviewIntro`)

`OverviewIntro` grows from today's slim card into the approved "structured read":

1. **Kicker + headline** — `byte · your companion` / "Here's my read of your project."
2. **Analysis rows** (the five fields as labeled rows). Three display states:
   - **loading** — a short "byte is sizing up your project…" placeholder in the rows
     (first visit, before the one call resolves; the store's `loading` flag drives it).
   - **ready** — the five labeled rows from the persisted analysis.
   - **absent** — omit the analysis block entirely (no brief / generation failed / older
     account) so the panel degrades to essentially today's intro. Never a dead-end.
3. **Compact "how to read this map" key** — one line (`center = your company · branches =
departments · dots = tasks · top strip = your stage`) plus the five color rows (reuse
   today's `LegendRow`s: cyan next-move / purple I'll-do-it / gold you-approve / blue
   needs-you / green done). Shown **always** in the briefing now (the point is to teach
   map-reading), replacing the old reopen-only legend.
4. **CTA** — unchanged: **"Show me my next move ▸"** → `onReveal` → the existing
   spotlight fly-to-beacon. The "? how to read this map" affordance still reopens this
   same panel (now with the persisted analysis, no new call).

`OverviewIntro` stays a **controlled, presentational** component: it receives the
analysis (or null), a `loading` boolean, and the existing `onReveal`/`onDismiss`/
`showLegend`-style props; `OverviewView` owns the phase machine, the store reads, and
the `ensureProjectAnalysis()` trigger — same ownership split as today.

## Pure, testable unit — `lib/ai/projectAnalysis.ts`

Kept pure for node-env Vitest (the stack has no React Testing Library):

```ts
export interface ProjectAnalysis {
  building: string;
  stage: string;
  edge: string;
  watchOut: string;
  focusNow: string;
}

// JSON schema handed to generateJson (all five fields required, additionalProperties false).
export const PROJECT_ANALYSIS_SCHEMA: Record<string, unknown>;

// byte's analysis system prompt (voice + anti-fabrication rules).
export const ANALYSIS_SYSTEM: string;

// Build the generation prompt from the brief context string.
export function analysisPrompt(context: string): string;

// True only if every field is a non-empty string — guards against a partial/garbled
// payload so the UI never renders blank rows (a bad payload → treat as absent → fallback).
export function isUsableAnalysis(a: unknown): a is ProjectAnalysis;

// The ordered [label, value] rows the panel renders — one source of truth for order/labels.
export function analysisRows(a: ProjectAnalysis): Array<{ label: string; value: string }>;
```

The route imports the schema/system/prompt; the client-side guard uses
`isUsableAnalysis`; the panel renders `analysisRows`. `briefToContext`, `generateJson`,
`loadServerBrief`, `usageSink`, and `aiErrorResponse` are reused unchanged.

## Data model & persistence changes

- `lib/firebase/schema.ts` — add to `CompanyDoc`: `projectAnalysis?: ProjectAnalysis`
  and `analyzedAt?: Millis`.
- `lib/firebase/companyData.ts` — `persistProjectAnalysis(companyId, analysis)` (writes
  `projectAnalysis` + `analyzedAt` + `updatedAt`, mirroring `persistPersonalization`);
  `loadCompanyData` returns `projectAnalysis` on `CompanyData`; the store holds it in
  state. No security-rules change — it's a field on the owner's own company doc, covered
  by the existing owner write rule (same as `personalizedAt`/`roadmapStage`).

## Coexistence (unchanged, must keep working)

The spotlight phase machine (`lib/overviewIntro.ts`), the `ByteGuide` beacon + tether,
the breadcrumb ribbon, the bottom legend, `openDept`, and the map graph are untouched.
`INTRO_SEEN_KEY` first-run gating is unchanged — returning users who dismissed the intro
still aren't re-prompted. The analysis is independent of the seen-flag: it generates once
per company and simply populates the panel whenever it's shown (first run or reopen).

## Edge cases

- **No brief / brief too thin** → route returns empty; panel omits analysis rows, keeps
  map key + CTA (today's behavior).
- **Generation fails / credits out (429/5xx)** → best-effort: `loading` clears, analysis
  stays absent, panel falls back. First-run is never blocked.
- **Partial/garbled payload** → `isUsableAnalysis` false → treated as absent.
- **Older account (onboarded pre-feature)** → no `analyzedAt`; the lazy
  `ensureProjectAnalysis()` on Overview mount generates it once.
- **Reopen via "? how to read this map"** → shows the persisted analysis; no new call.
- **Reduced motion** → the panel adds no new motion; the loading placeholder is a static
  line, not an animation dependency (a subtle pulse is acceptable but optional).
- **Usage accounting** → the call records to the per-user daily usage counter via
  `usageSink` (so it's visible in Billing & Usage) but is not 429-gated; being one-time,
  it adds at most one call per company.

## Testing

- **Unit (`lib/ai/projectAnalysis.test.ts`, node-env Vitest):** `isUsableAnalysis`
  accepts a full five-field object and rejects each missing/empty/non-string field and
  non-objects; `analysisRows` returns the five rows in the fixed order with the right
  labels; `analysisPrompt` includes the passed context; the schema lists all five fields
  as required with `additionalProperties: false`.
- **Route (contract, consistent with the repo's existing route tests):** no/invalid
  token → 401; no brief → empty object; a valid brief → the five-field object (mocked
  client). Follow whatever pattern `personalize`/`scaffold` route tests use, if any;
  otherwise cover the pure pieces and verify the route by hand on preview.
- **Manual (Vercel PR preview, prod build — NOT `next dev`; StrictMode double-mount +
  reset make first-run unreadable locally, per the standing rule):** fresh account →
  Overview first-run shows the loading placeholder, then byte's five-row read of the real
  brief; the map key + colors render; "Show me my next move ▸" still flies to and
  spotlights the beacon; reload → analysis persists, no regeneration; "? how to read this
  map" reopens the same briefing; a thin-brief account degrades gracefully.

## Non-goals (YAGNI)

- No multi-step guided tour / coach-marks; no standalone "Your project" report surface.
- No change to the spotlight, beacon, breadcrumb, legend behavior, or the map/graph.
- No new analysis fields beyond the five (no "next milestone", etc. — can follow later).
- No re-generation UI ("re-analyze") in this pass; it's one-time.
- No security-rules change; no new dependencies.

## Dependencies & sequencing

Builds off `origin/main` (tip `0fd96fa`, includes the merged breadcrumb #90) as a
standalone PR. Reuses the `personalize`/`scaffold` route pattern, `briefToContext`,
`generateJson`, `usageSink` (cost guard), and the `personalizedAt` one-time-stamp
persistence pattern. Given concurrent sessions on the local checkout, do the work in an
isolated git worktree; **verify on the Vercel preview** (first-run + a live model call
are unreadable under `next dev`); ensure `ANTHROPIC` key + `AI_*` env are set for the
**Preview** Vercel scope (a known past gotcha: keys unset for Preview silently fall back
to seed); run `npm run format:check` before pushing (CI runs `prettier --check .`
repo-wide).
