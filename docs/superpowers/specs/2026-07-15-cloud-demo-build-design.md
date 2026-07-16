# Cloud demo build — "Let's build" in the cloud, on company credits

**Date:** 2026-07-15
**Goal:** Let a non-technical founder run a real "Let's build" **demo** (a throwaway
landing page) with **nothing installed and no terminal** — Codepet runs the `claude`
session in an **E2B cloud sandbox** on the **company's** Anthropic key, streams it live
into the existing build UI, hosts the result at a Codepet URL, and charges the
company's **credits**.

This is **sub-project #1** of the larger pivot "Let's build runs in Codepet's cloud,
billed to company credits." It is deliberately scoped to the **demo** case (throwaway
workspace, static result, watch-only) to de-risk the sandbox infrastructure. Builds
into a founder's **real project** (persistent workspace, their repo, interactive
permissions) are later sub-projects.

## Decisions locked in brainstorming

- **Execution backend:** E2B sandbox-as-a-service (offloads the hard part — securely
  isolating an agent that runs arbitrary bash — to a purpose-built provider).
- **Streaming:** reuse the existing **remote self-report → Firestore → browser subscribe**
  path. The sandbox is "the remote machine," except Codepet boots it instead of the user
  pasting a command. The app (on Vercel serverless) only **boots the sandbox and returns**
  — no long-lived connection.
- **Interactivity:** **watch-only.** No live Allow/Deny permission round-trips (hard on
  serverless, and pointless in a disposable sandbox). The build runs non-interactive
  (`--permission-mode bypassPermissions`); the founder watches the real stream.
- **Billing:** the company pays **credits**, at a **fixed cost per build** (matches the
  existing per-action credit model in `lib/ai/credits.ts`, chosen for predictable spend),
  gated on the plan's included allowance. A **separate per-build token cap** protects
  Codepet's raw API bill (distinct from what the user is charged).
- **Result:** static site pulled out of the sandbox → **Firebase Storage** → served at a
  Codepet preview URL.

## Current state (grounded)

- `lib/store.tsx` `armBuild` has **local** (spawns `claude` via `/api/build-session/*`)
  and **remote** (shows a copy-paste `demoTerminalCommand`) branches. It already
  `subscribeLiveBuild(companyId, buildSessionId, …)` in non-local mode (store line ~602),
  updating `buildLive` from `liveBuilds/{buildSessionId}`.
- `app/api/track/live/route.ts` + `app/api/track/demo-recap/route.ts` are the existing
  ingest endpoints (per-company **ingest token** auth; demo-recap writes
  `liveBuilds/{buildSessionId}.recap` with merge-per-key). The remote demo path already
  self-reports commits/files/tokens to these.
- `lib/armSession.ts` builds `demoTerminalCommand(prompt, report)` — the throwaway
  landing-page seed + `claude …` + self-report curls — and exports `DEMO_DIR`/`DEMO_URL`/
  `DEMO_PORT` and `tokenReportSuffix`.
- `lib/liveBuild.ts` holds `LiveState` (`actionCount`, `recentTools`, `tokens`, `recap`,
  `ended`) and `sanitizeDemoRecap`.
- `lib/ai/credits.ts` — **per-action** credit model: `CREDIT_COSTS` (chat .25 / light 1 /
  medium 2 / heavy 4), `ROUTE_CREDITS`, `creditCostForRoute(key)`, `PRO_INCLUDED_CREDITS`
  (800), `creditsRemaining(used, included)`. **Note in the file:** this core is _not yet
  wired into any route_ — this feature is the **first real credit gate + charge**.
- `lib/billing.ts` — `creditsFromUsage(docs)` (Σ calls × route cost), `creditMeter(used,
allowance)`.
- `usageSink(uid, idToken, routeKey)` (`lib/firebase/serverUsage`) records a route call
  into the day's usage doc (how `chat` is metered today).
- `app/actions/build.ts` `scaffoldDemoProject` seeds the throwaway landing page locally.

**Key reuse:** the browser DURING view, the piggy-bank meter, the token feed, the
`liveBuilds/{id}` subscription, and the stream-json → LiveState projection **all already
work for a remote self-reporting build**. This feature makes the "remote machine" an E2B
sandbox and adds credit + preview. It does **not** rebuild the live UI.

## Architecture

### A. Execution flow

1. Founder taps **Build this** in demo mode on a hosted/cloud deployment (`cloudDemoBuild`
   flag on) → `armBuild` calls `POST /api/build/cloud-start` with the Firebase ID token,
   the plan, and the brief.
2. **`/api/build/cloud-start`** (Node runtime):
   - verify the Firebase ID token → `uid` + `companyId`;
   - **credit gate** (§B): if remaining allowance < build cost → `402 { error: 'no_credits' }`,
     no sandbox booted;
   - **single-flight**: if `liveBuilds/{…}` shows an active cloud build for this company
     → `409 { error: 'build_in_progress' }`;
   - mint a `buildSessionId` and an **ingest token** (same helper the toolkit install uses);
   - create an **E2B sandbox** from a prebuilt template (`node` + `claude` preinstalled),
     with `env: { ANTHROPIC_API_KEY: <company key> }` and a hard **timeout (8 min)**;
   - run the **build script** (§C) in the **background** inside the sandbox (detached), then
     **return `{ buildSessionId }` immediately** (fast — within the serverless limit);
   - write an initial `liveBuilds/{buildSessionId}` doc (`{ startedAt, mode: 'cloud',
companyId, ended: false }`).
3. **Browser**: `armBuild` sets non-local build state + `subscribeLiveBuild(...)` (existing).
   The DURING view shows the piggy bank / tokens / step feed live from Firestore.
4. Sandbox finishes (or the token cap / timeout fires) → the script calls
   **`/api/build/cloud-finalize`** (§E) with the built files + total tokens + status →
   the app stores the site, sets `previewUrl`, charges credits, marks `ended`.
5. Browser sees `ended` → END recap with **Open your demo page →** (`previewUrl`).

### B. Credit gate + charge (`lib/build/credits.ts`, pure where possible)

- Add `build: 5` to `CREDIT_COSTS` and a `build` entry to `ROUTE_CREDITS` in
  `lib/ai/credits.ts` (**5 credits/build**, a tunable constant; the exact number is a
  pricing decision).
- **Gate (pure):** `canAffordBuild(usedCredits: number, allowance: number): boolean` =
  `creditsRemaining(usedCredits, allowance) >= creditCostForRoute('build')`.
  `cloud-start` computes `usedCredits` via `creditsFromUsage` over the company's usage
  docs and `allowance` from the plan (`PRO_INCLUDED_CREDITS` / trial), and blocks when
  false. **MVP gates on the included allowance only** — no Stripe overage.
- **Charge:** on a **successful** finalize, record one `build` call via `usageSink` so it
  shows in Billing like any other usage. A **hard-failed** build (no output) is **not
  charged**.
- **Token cap (cost safety, separate from credits):** the build script tracks the running
  token total from claude's own stream-json `usage` and **kills `claude` when it exceeds
  `BUILD_TOKEN_CAP` (1.5M)** — protects the company's raw API bill even if a build loops.

### C. The sandbox build script (`lib/build/cloudBuildScript.ts`, pure builder)

A pure function `cloudBuildScript(input): string` (mirrors `demoTerminalCommand`) that
returns a bash script the sandbox runs. Testable without a network. It:

- seeds the throwaway landing page into `~/codepet-demo` (the demo seed, same HTML as
  `scaffoldDemoProject`);
- runs `claude "<opening prompt>" --output-format stream-json --verbose
--permission-mode bypassPermissions` in `~/codepet-demo`;
- **pipes each stream-json line** to a small self-report loop → `POST {apiUrl}/api/track/live`
  (the existing live endpoint) with `{ companyId, token, buildSessionId, event }`, so the
  browser sees steps/tokens live;
- **accumulates tokens** from the `usage` fields; if the total exceeds `BUILD_TOKEN_CAP`,
  kills claude;
- on exit (success **or** error — a bash `trap`), gathers the built web files under
  `~/codepet-demo` (excluding `.git`, capped at 5MB total) and `POST`s
  `/api/build/cloud-finalize` with `{ companyId, token, buildSessionId, status, tokens,
files: [{ path, base64 }] }`, then exits so E2B tears the sandbox down.

All ids/tokens/apiUrl are baked into the script at boot; the company Anthropic key is set
via the sandbox **env**, never written into the script text or returned to the client.

### D. Store + UI (`lib/store.tsx`, `components/views/BuildCoachView.tsx`)

- `armBuild`: add a **cloud** branch, chosen when `cloudDemoBuild` flag is on AND
  (demo mode AND capability is remote/hosted). It calls `cloud-start`, sets the non-local
  build state (so the existing `subscribeLiveBuild` runs), and shows **no** copy-paste
  command. On `402 no_credits` → a friendly chat message linking to Billing; on `409` → a
  "a build's already running" message.
- DURING copy in cloud mode: byte says _"Byte is building your demo in the cloud — watch
  it happen ✨"_ (no terminal instructions; `launchCommand` stays null).
- END recap: **Open your demo page →** points at the build's `previewUrl` (from Firestore)
  when cloud, instead of `DEMO_URL`.
- Add `previewUrl?: string` to `LiveState`/`liveBuilds` doc and surface it in the recap.
- **Feature flag** `cloudDemoBuild` (env-driven, default OFF) so this rolls out safely.

### E. Finalize + hosting (`app/api/build/cloud-finalize/route.ts`, `app/preview/[id]/…`)

- `cloud-finalize` (Node runtime): validate the **ingest token** against `companyId`
  (same as `demo-recap`); `sanitizeFinalizeBody` (§F) the payload (clamp token count,
  cap total bytes at 5MB, **reject unsafe paths**); upload each file to Firebase Storage
  at `builds/{companyId}/{buildSessionId}/<path>`; set
  `liveBuilds/{buildSessionId}.{ previewUrl, tokens, ended: true }`; **on `status:'ok'`**
  charge 5 credits via `usageSink` (skip on failure).
- **Preview:** `GET /preview/{buildSessionId}` (+ `/*` for assets) serves the stored files
  from Storage (index.html + assets), read-through by `buildSessionId`. This is the
  `previewUrl`.

### F. `sanitizeFinalizeBody` (`lib/build/finalize.ts`, pure — security-critical)

`sanitizeFinalizeBody(body): { tokens: number; files: {path,base64}[] } | null` —

- `tokens`: floored, ≥0, capped at `2_000_000_000`;
- `files`: each `path` must be a **relative, normalized, traversal-free** web path
  (reject `..`, leading `/`, backslashes, null bytes); each `base64` a valid string;
- total decoded bytes ≤ 5MB, file count ≤ 50; returns null on any violation.

## Data flow

`Build this` → `cloud-start` (gate + boot E2B, return fast) → sandbox script (seed → claude
stream-json → self-report `/api/track/live` → Firestore `liveBuilds/{id}`) → **browser
watches Firestore live** → sandbox `trap`/exit → `cloud-finalize` (store site, set
`previewUrl`, charge credits, `ended`) → browser END recap → **Open your demo page →**
(`previewUrl`). Sandbox torn down by E2B (timeout backstop).

## Error handling

- `cloud-start`: bad/absent token → 401; not enough credits → 402 (no boot, no charge);
  a build already running → 409; E2B create fails → 502 + friendly chat message, no charge.
- Build errors mid-run: the script's `trap` still finalizes with `status:'error'` and
  whatever tokens/files exist → build marked `ended` (error), **not charged**.
- Sandbox dies without finalizing: the `liveBuilds` doc stays `ended:false`; the client
  shows a **"this build didn't finish"** state after the max build duration (no silent
  infinite wait). A later cleanup job (out of scope) can reconcile.
- Finalize with a bad payload (traversal, oversize) → 400, nothing stored, not charged.
- Keys: E2B API key and the company Anthropic key are **server-only env**, never returned
  to the client; the ingest token is per-company and single-purpose.

## Out of scope (later sub-projects)

- Builds into a founder's **real project** (persistent workspace, their repo, git, rewind).
- **Interactive permissions** in the cloud (live Allow/Deny).
- The full **credit engine** (Stripe overage, plan-state model) — MVP gates on the
  included allowance only.
- Dynamic/server-rendered results (MVP hosts a **static** site).
- Preview **TTL/cleanup** and per-user concurrency beyond one-at-a-time.

## Security / robustness notes

- The sandbox is disposable and isolated by E2B; `bypassPermissions` is safe there.
- `sanitizeFinalizeBody` path-traversal rejection is the critical guard (a sandbox posts
  arbitrary `{path}`) — must be unit-tested against `..`, absolute, and backslash paths.
- The token cap protects raw API cost independently of the fixed credit charge.
- Ingest-token auth on both `track/live` and `cloud-finalize`, same posture as `demo-recap`.

## Testing

- **Pure unit tests:** `cloudBuildScript` (seeds demo, runs claude stream-json, self-reports,
  finalizes on trap, embeds ids/cap); `canAffordBuild` (gate boundary at exactly the cost);
  `creditCostForRoute('build')` returns 5; `sanitizeFinalizeBody` (**traversal/oversize/
  count rejection** + clamps); preview-URL construction.
- **Route tests (mock E2B + mock Firebase):** `cloud-start` (gate 402, single-flight 409,
  boots + returns fast, writes initial doc); `cloud-finalize` (ingest-token auth, stores
  files, sets previewUrl, charges on ok, skips charge on error).
- **Infra (documented, not unit-tested):** building the E2B template with `claude`
  preinstalled; required env: `E2B_API_KEY`, company `ANTHROPIC_API_KEY`, `CODEPET_API_URL`.
- **Manual E2E:** one real demo build on E2B → live stream in the UI → preview URL loads →
  5 credits deducted → out-of-credits blocks the next build.

## Success criteria

- On a hosted deployment with the flag on, a founder taps **Build this** (demo) and — with
  **nothing installed, no terminal** — watches a real `claude` build run live, then opens
  the finished landing page at a Codepet URL.
- The build is charged exactly **5 company credits** on success; a hard failure charges 0;
  a build is **blocked** when the company is out of included credits.
- A runaway build is killed at the token cap; the sandbox always tears down (timeout).
- `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test` pass (new unit
  tests for the pure builders/sanitizers + route tests).

## Env / keys required (you provide before E2E)

- `E2B_API_KEY` (E2B account), the company `ANTHROPIC_API_KEY` (already used by byte's
  server AI), and a reachable `CODEPET_API_URL` for the sandbox to self-report to.
