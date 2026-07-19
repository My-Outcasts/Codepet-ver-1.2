# GitHub-backed cloud build — real-project builds on company credits

**Date:** 2026-07-16
**Goal:** Let a founder build into their **real GitHub repo** from Codepet, entirely in
the cloud on **company credits** — connect (or create) a repo, describe a change, and a
cloud sandbox clones the repo, runs `claude` to make the change, and pushes it back as a
**branch + pull request**. No local install, no terminal.

This is **Phase 1** of "real-project cloud build," the follow-on to the demo cloud build
(shipped in PR #152). It reuses that foundation and adds GitHub. Kept deliberately tight:
**watch-only, one-shot**, result is a **PR** (not a merge/deploy). Two-way sessions,
interactive permissions, variable credit metering, live-app preview, and deploy are
**later phases** (see Out of scope).

## Decisions locked in brainstorming

- **Repo entry:** both — connect an **existing** repo AND **create a new** one. Both feed
  one pipeline (clone → build → push → PR).
- **GitHub auth:** a **GitHub App** ("Codepet Builder"), installed once per company on the
  repos the founder chooses; fine-grained, revocable; installation tokens for git ops.
- **Result:** push to a **branch** (`codepet/<buildSessionId>`) + open a **PR**. Never
  touch `main`.
- **Persistence:** GitHub is the durable store — the sandbox **clones fresh each build**
  and pushes back. No persistent sandbox volume, no file-upload/preview hosting.
- **Interactivity / scope:** **watch-only, one-shot** (like #152). The founder watches the
  live stream; there is no live Allow/Deny and no follow-up turns in Phase 1.
- **Billing:** reuse the **flat 5 credits/build** model from #152 (charged on a successful
  push). Per-build **token cap raised to 3M** (real repos are heavier than the demo's 1.5M).

## Current state (grounded — reused from #152, on `develop`)

- `lib/build/cloudSandbox.ts` — `startCloudBuild({ script, anthropicKey })` boots an E2B
  sandbox from the `codepet-build` template, runs a script detached, returns `{ sandboxId }`.
- `lib/build/cloudBuildScript.ts` — `cloudBuildScript(input): string` builds the sandbox's
  bash launcher (seed → run claude stream-json → self-report to `/api/track/live` → finalize
  on a trap). We add a **repo-aware** builder alongside it.
- `app/api/build/cloud-start/route.ts` — verifies the Firebase token → **companyId = uid**
  (never the body — the #152 IDOR fix), credit-gates (`canAffordBuild`/`loadPeriodCreditsAdmin`),
  single-flights, mints an ingest token, boots the sandbox, writes the initial `liveBuilds`
  doc. We extend/mirror this for repo builds.
- `app/api/build/cloud-finalize/route.ts` — ingest-token auth, records the result, charges
  5 credits on success, marks `ended`. We extend the payload to carry the **PR url** instead
  of files.
- `lib/build/cloudStore.ts` — `finalizeBuild(...)` (transactional claim → charge on ok),
  `previewUrlFor`. We reuse the claim/charge; the "store files" step is replaced by
  "record PR url".
- `lib/liveBuild.ts` — `LiveState` (+ `mode`, `companyId`, `previewUrl` carried through
  `reduceLive`). We add `prUrl`/`repo`.
- `lib/ai/credits.ts` — `canAffordBuild`, `creditCostForRoute('build') === 5`.
- Store `armBuild` cloud branch (behind `NEXT_PUBLIC_CLOUD_DEMO_BUILD`) — the model for the
  new real-repo cloud branch (behind its own flag).

**Reuse verbatim:** the E2B boot + detached run, self-report → `liveBuilds/{id}` → browser
subscribe, the credit gate + transactional charge, ingest-token auth, the DURING piggy-bank/
token UI. **New:** the GitHub App, the connect/create-repo flow, the repo-aware build script
(clone/branch/push/PR), the repo-ownership guard, and a repo selector in the arm step.

## Architecture

### A. The GitHub App

- Register a GitHub App **"Codepet Builder"** (one-time, by us). Permissions: **Contents**
  (read/write — clone + push), **Pull requests** (write — open PRs), **Metadata** (read).
- Two token types (both from the same App): **installation tokens** (server-minted from the
  App private key, repo-scoped) for clone/push/PR; and a **user access token** (user-to-server
  OAuth) used only for **create new repo** — creating a repo on the founder's own account
  acts as the user, avoiding an account-level Administration permission. After create, the
  installation covers the new repo.
- Env: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_ID`,
  `GITHUB_APP_CLIENT_SECRET` (server-only).

### B. Connect / create a repo

- **Connect flow:** in-app **Connect GitHub** → redirect to the App's install page with a
  **signed `state`** (`{ companyId, nonce }`, HMAC-signed server-side) → GitHub redirects to
  **`GET /api/github/callback`** with `installation_id` + `state` → verify the signature,
  bind `installation_id` to that company: write `company.github = { installationId, login,
connectedAt }`.
- **List existing:** `GET /api/github/repos` — mint an installation token, call GitHub's
  _installation repositories_ API, return `[{ owner, name, private }]` for the picker.
- **Create new:** `POST /api/github/repos` — create a repo on the founder's account from a
  **starter template** (Phase 1 ships **one** template), then it's an installed repo.

### C. Build flow (mirrors #152, repo-aware)

1. Founder picks a repo + describes the change → `POST /api/build/repo-start`
   (body `{ repo: { owner, name }, plan, brief }` — **no companyId**).
2. Server (Node): verify token → `companyId = uid`; **credit gate**; **single-flight**;
   **ownership guard** — the chosen repo must be in the company's installation's repo list
   (else 403); mint a **short-lived, repo-scoped installation token**; mint ingest token +
   `buildSessionId`; build the repo-aware script; `startCloudBuild(...)`; write the initial
   `liveBuilds/{buildSessionId}` doc (`{ companyId, mode: 'repo', repo, ended: false }`);
   return `{ buildSessionId }`.
3. **Sandbox script** (`repoBuildScript`): `git clone` the repo (installation-token auth) →
   `git checkout -b codepet/<buildSessionId>` → run `claude` (watch-only,
   `--permission-mode bypassPermissions`, streaming stream-json → self-report to
   `/api/track/live`) → track tokens, kill claude past the **3M** cap → `git add/commit` →
   `git push` the branch → **open a PR** via the GitHub API → `POST /api/build/repo-finalize`
   with `{ status, tokens, prUrl, branch }` → exit (E2B tears down on the 8-min timeout).
4. Browser watches `liveBuilds/{buildSessionId}` live (piggy bank/tokens/steps).
5. `repo-finalize`: ingest-token auth → transactional claim → on `status:'ok'` with a
   pushed branch: record `prUrl`/`branch`/`tokens`, **charge 5 credits**, mark `ended`.
6. END recap shows **"View the pull request →"** (`prUrl`).

### D. Store + UI

- `armBuild`: a **real-repo cloud branch**, chosen when the new flag
  `NEXT_PUBLIC_CLOUD_REPO_BUILD` is on AND it's a **non-demo** build AND capability is remote
  AND GitHub is connected. Not connected → post a "Connect GitHub to build in the cloud"
  message with the connect action. It calls `/api/build/repo-start` with the selected repo.
- The plan/arm step shows a **repo selector** (`Build into: [repo ▾]` + "Connect another /
  Create new") instead of the local project picker or the demo notice.
- END recap: **View the pull request →** using `liveBuilds.prUrl`.
- `LiveState` gains `prUrl?: string` and `repo?: { owner: string; name: string }`, carried
  through `reduceLive` (like `previewUrl`).

## Credit + security

- **Credit:** flat **5/build**, gated on the included allowance before boot, charged only on
  a **successful push** (real output landed). Token cap **3M** protects the raw API bill.
- **Installation token:** minted per build, **short-lived (~1h)**, **scoped to the one target
  repo**, passed to the sandbox via env, never returned to the client, used only for
  clone + push.
- **Ownership guard:** the repo must belong to the company's installation — prevents building
  into someone else's repo. `companyId` is always the verified Firebase uid (never body).
- **Push safety:** branch + PR only; `main` untouched.
- Company `ANTHROPIC_API_KEY`, `GITHUB_APP_PRIVATE_KEY`, `E2B_API_KEY`, the ingest token, and
  the installation token are all **server-only**; never in client responses.

## Error handling

- Out of credits → 402 (no boot, no charge). Build already running → 409. Repo not in the
  installation → 403. GitHub not connected → UI prompts connect.
- Installation-token mint / GitHub API failure → 502, no charge.
- **Clone fails** (access revoked, repo too large) → sandbox reports `error` → finalize
  error, **not charged**, message: "Couldn't access your repo — reconnect GitHub?"
- **Push/PR fails** (protected branch, conflict) → **charge only if a branch was pushed**;
  if the push itself fails, **not charged**.
- **Timeout / token cap** mid-build → kill claude, push whatever's committed as the branch +
  a PR noting "hit the limit"; charged (work happened).
- Founder revokes the App → installation token invalid → next build fails gracefully →
  prompt to reconnect.

## Out of scope (later phases)

- **Two-way** interactive sessions + follow-up turns (Phase 2).
- **Interactive Allow/Deny** permissions in the cloud (Phase 3).
- **Variable credit metering** + the credit engine / Stripe overage (Phase 4).
- **Live-app preview** (running dev server) and **deploy/ship** (Phase 5).
- Auto-merge to `main`; multiple starter templates; monorepo/build-config detection; using
  the repo's runtime secrets.

## Testing

- **Pure unit:** `repoBuildScript` (clone → branch → claude → push → PR, ids/token/cap baked,
  never embeds the App private key); the **ownership guard** (repo ∈ installation repos);
  the signed-`state` verify (`/api/github/callback`); `branch`/`prUrl` builders; credit gate
  (reused).
- **Route tests (mock GitHub API + E2B + Firebase):** `repo-start` (gate, single-flight,
  ownership 403, mint token, boot, initial doc); `repo-finalize` (charge on ok-with-push,
  no charge on error/no-push); `github/callback` (bad signature → 401, good → stores
  installationId); `github/repos` list + create.
- **Infra / manual E2E:** a real Codepet Builder App on a test account + a throwaway repo +
  E2B + keys → connect → clone → build → branch + PR end-to-end; verify 5 credits charged
  once and `main` untouched.
- `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test` pass.

## Env / keys required (you provide before E2E)

- The Codepet Builder GitHub App: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`,
  `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, and a webhook/callback URL.
- Existing cloud env: `E2B_API_KEY`, company `ANTHROPIC_API_KEY`, `CODEPET_API_URL`.
- Flag: `NEXT_PUBLIC_CLOUD_REPO_BUILD=1` to enable the client path.

## Success criteria

- On a hosted deployment with the flag + keys, a founder connects (or creates) a GitHub repo,
  describes a change, watches a real cloud build, and gets a **PR** on their repo with the
  change — no install, no terminal.
- Exactly **5 credits** charged on a successful push; nothing charged on a hard failure or a
  failed push; `main` is never modified.
- The repo-ownership guard blocks building into a repo outside the company's installation.
- A runaway build is killed at the 3M token cap; the sandbox always tears down.
