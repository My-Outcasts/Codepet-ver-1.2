# New project vs existing project — the build fork

**Date:** 2026-07-16
**Goal:** At the start of "Let's build", let the founder choose **"Start a new project"** vs
**"Build a feature in an existing project"**. The existing-project path reuses the shipped
GitHub cloud build. The new-project path **creates a real GitHub repo from a Next.js
starter template** (on company credits) and builds into it — no terminal, no manual repo
setup.

Builds on **GitHub-backed cloud build** (branch `feat/github-cloud-build`): the repo
selector, `/api/build/repo-start`, `/api/github/callback`, and `createRepoFromTemplate`
(currently a 501 stub) already exist. This spec adds the fork UI and unblocks repo
creation via a GitHub App **user access token** captured during install.

## Decisions locked in brainstorming

- **Scope:** full — the fork UI **and** a working "create new project" path (not a stub).
- **Fork placement:** an **upfront fork** right when the founder hits "Let's build", before
  byte brainstorms.
- **Template:** one — a **minimal Next.js app** (`codepet-templates/starter`, a GitHub
  template repo on the Codepet org; out-of-repo setup, like the E2B template).
- **User token:** captured via the GitHub App's **"Request user authorization (OAuth)
  during installation"** — the install callback also returns a `code` we exchange for a
  **non-expiring** user access token (no refresh machinery for MVP).
- **New-repo coverage:** after create, **add the repo to the installation via the user
  token** (`PUT /user/installations/{id}/repositories/{repoId}`) so `repo-start` can build
  into it regardless of All-vs-Select install choice.
- **Result:** branch + PR (same as the existing-project path).

## Current state (grounded — on `feat/github-cloud-build`)

- `app/api/github/callback/route.ts` — GET; `verifyState(state)` → companyId; `setCompanyGithub`.
  We extend it to also exchange a `code` → user token.
- `app/api/github/repos/route.ts` — GET lists installation repos; **POST is a 501 stub**
  (`create_not_available`) precisely because no user token was stored yet. We unstub POST.
- `lib/github/repos.ts` — `CODEPET_TEMPLATE = 'codepet-templates/starter'`,
  `createRepoFromTemplate(userToken, name): Promise<RepoRef>` (we extend the return to carry
  the new repo's numeric `id` for add-to-installation), `RepoRef {owner,name}`,
  `repoInInstallation`, `listInstallationRepos`.
- `lib/github/appAuth.ts` — `appJwt`, `installationToken`.
- `lib/firebase/companyDataAdmin.ts` — `getCompanyGithub`/`setCompanyGithub`
  (`company.github = { installationId, login, connectedAt }`). We add user-token storage.
- `app/api/build/repo-start/route.ts` — the repo build starter (credit gate, ownership
  guard, mint installation token, boot). Reused unchanged — the new-project path just
  points it at the freshly created repo.
- `lib/store.tsx` — `armBuild` repo-cloud branch, `buildRepo`/`setBuildRepo`,
  `connectGithub`, `startBuildIntake`, the brainstorm intake. `cloudRepoBuild` flag.
- `components/Copilot.tsx` — the `start-building` block's repo selector (existing path).

## Architecture

### A. User token via the install callback (`app/api/github/callback`)

Enable "Request user authorization (OAuth) during installation" on the App. The post-install
redirect then carries `code` alongside `installation_id` + `state`. The callback:

1. `verifyState(state)` → `companyId` (401 on bad state) — existing.
2. `setCompanyGithub(companyId, { installationId, login })` — existing.
3. **New:** if `code` present → `POST https://github.com/login/oauth/access_token` with
   `{ client_id: GITHUB_APP_CLIENT_ID, client_secret: GITHUB_APP_CLIENT_SECRET, code }`
   (`Accept: application/json`) → `{ access_token }` → store it:
   `setCompanyGithubUserToken(companyId, access_token)` writing `company.github.userToken`
   (admin, server-only; never returned to the client). Token exchange failure is
   non-fatal — the installation still binds; the founder just can't create new repos until
   they reconnect.

### B. Storage (`lib/firebase/companyDataAdmin.ts`, `lib/firebase/schema.ts`)

- Extend `CompanyDoc.github` to `{ installationId; login; connectedAt; userToken?: string }`.
- `setCompanyGithubUserToken(companyId, userToken)` — merge-write `github.userToken`.
- `getCompanyGithubUserToken(companyId): Promise<string | null>` — server-only read.

### C. Create repo (unstub `POST /api/github/repos`)

- Verify Firebase token → `companyId = uid`.
- `sanitizeRepoName(raw)` (pure) — trim; allow `A–Za–z0–9-_.`; 1–100 chars; reject
  otherwise → 400. (GitHub silently rewrites some names; we reject up front for
  predictability.)
- `const userToken = await getCompanyGithubUserToken(companyId)` → null → 400
  `{ error: 'reconnect_github' }`.
- `const repo = await createRepoFromTemplate(userToken, name)` (extended to return
  `{ owner, name, id }`) — on GitHub failure (name taken, etc.) → 422 `{ error: 'create_failed' }`.
- `const gh = await getCompanyGithub(companyId)` → `await addRepoToInstallation(userToken,
gh.installationId, repo.id)` (`PUT /user/installations/{installationId}/repositories/{repoId}`)
  so the installation covers the new repo. Failure → 502 `{ error: 'coverage_failed' }`
  (don't hand back a repo the build can't reach).
- Return `{ repo: { owner, name } }`.

### D. The fork UI + flows (`lib/store.tsx`, `components/Copilot.tsx`)

- New store state `buildTarget: 'new' | 'existing' | null`, reset on `startBuildIntake`.
- When the repo-cloud context is active (`cloudRepoBuild && !demoLetsBuild && cap.mode ===
'remote'`), `startBuildIntake` posts a **fork message** with two `buildAction`s
  (`target-new` / `target-existing`) instead of the brainstorm opener. Clicking one sets
  `buildTarget` and then posts `INTAKE_OPENING` (starts the brainstorm). Outside that
  context (demo/local/flag-off), the flow is unchanged (no fork).
- Arm step (`components/Copilot.tsx` `start-building` block):
  - `buildTarget === 'existing'` → the existing repo selector (unchanged).
  - `buildTarget === 'new'` → a **project-name input** + **Create & build** button →
    `createProject(name)` store action → `POST /api/github/repos` → on 200 `setBuildRepo(repo)`
    then `armBuild()` (which runs `repo-start` into the new repo). 400 `reconnect_github` →
    a "reconnect GitHub" message; 422/other → a friendly retry message.
- Both paths require GitHub connected; if not → the existing "Connect GitHub" affordance
  (which now also captures the user token via §A).

## Credit + security

- Creating a repo is **free** (no build credit); the **build** into it charges the usual
  5 credits via `repo-start`/`repo-finalize` (unchanged).
- The **user token** is a company secret: admin-written, server-only-read, **never** in a
  client response. `companyId` is always the verified Firebase uid.
- The new repo is created on the **founder's own** account (user token acts as them); the
  installation is the company's own; `repo-start`'s ownership guard still applies.

## Error handling

- Callback code-exchange fails → installation still binds; create is unavailable until
  reconnect (surfaced as 400 `reconnect_github` at create time).
- Create: blank/invalid name → 400; no user token → 400 `reconnect_github`; GitHub create
  failure → 422; add-to-installation failure → 502 (no half-created "unreachable" repo
  handed back).
- The fork: if the founder closes/ignores it, no build starts (same as cancelling intake).

## Out of scope (later)

- Multiple starter templates (one Next.js template for now).
- Expiring user tokens + refresh (chose non-expiring).
- Auto-deploying the new project (Phase 5).
- A materially different brainstorm for new vs existing (shared brainstorm for MVP; only the
  opener copy differs).
- Renaming/deleting projects from Codepet.

## Testing

- **Pure unit:** `sanitizeRepoName` (accepts good names, rejects blank / bad chars / too
  long / traversal-ish); the fork decision (which `buildAction`s post given the repo-cloud
  context).
- **Route tests (mock GitHub fetch + admin):** `github/callback` code-exchange (code present
  → user token stored; exchange failure → still binds, no token); `github/repos` POST
  (no user token → 400 reconnect; blank name → 400; create success → `createRepoFromTemplate`
  - `addRepoToInstallation` called, returns `{repo}`; create failure → 422; coverage failure
    → 502).
- **Store:** the fork sets `buildTarget` and posts `INTAKE_OPENING` after; `createProject`
  posts to `/api/github/repos` and on 200 sets `buildRepo` + arms. (Typecheck/lint/suite.)
- **Manual E2E:** connect (captures user token) → New project → name it → repo created from
  the Next.js template + added to the installation → builds into it → PR appears; 5 credits
  charged once.

## Env / setup required (you provide before E2E)

- On the GitHub App: enable **"Request user authorization (OAuth) during installation"**;
  disable **"Expire user authorization tokens"** (non-expiring). `GITHUB_APP_CLIENT_ID` +
  `GITHUB_APP_CLIENT_SECRET` set (already in `.env.example`).
- Create the **`codepet-templates/starter`** repo (minimal Next.js app) on the Codepet org
  and mark it a **template repository**.
- Everything from GitHub-backed cloud build (App registration, E2B, keys, flag).

## Success criteria

- Hitting "Let's build" (repo-cloud context) shows a **New / Existing** fork before the
  brainstorm.
- **Existing** → unchanged (pick repo → build → PR).
- **New** → name it → a real GitHub repo is created from the Next.js template, added to the
  installation, and built into → a PR appears; the user token stays server-side; 5 credits
  charged once on the build.
- Blank/invalid name, missing user token, and GitHub failures all give clear, non-charging
  errors.
- `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test` pass.
