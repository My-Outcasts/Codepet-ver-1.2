# New project vs existing project fork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At "Let's build", the founder picks **New project** vs **Existing project**; the new-project path creates a real GitHub repo from a Next.js template (user token captured during install) and builds into it.

**Architecture:** Extend the GitHub cloud build (branch `feat/github-cloud-build`). Capture a GitHub App **user access token** in the install callback (exchange the `code`), store it server-side, unstub `POST /api/github/repos` to create-from-template + add-to-installation, and add a fork + new-project name input to the store/UI. The existing-project path is reused unchanged.

**Tech Stack:** Next.js (Node routes), React, TypeScript, Firebase Admin, GitHub REST API via `fetch`, Vitest.

## Global Constraints

- New-project result = branch + PR (same as existing). Creating a repo is free; the build charges the usual 5 credits via `repo-start`/`repo-finalize` (unchanged).
- `companyId` is always the verified Firebase `uid` — never from a request body.
- The GitHub **user token** is a company secret: admin-written, server-only-read, **never** in any client response.
- User tokens are **non-expiring** (App setting) — no refresh machinery.
- Template = `codepet-templates/starter` (const `CODEPET_TEMPLATE`, already in `lib/github/repos.ts`).
- After create, add the new repo to the installation (`PUT /user/installations/{id}/repositories/{repoId}`) so `repo-start` can reach it.
- Fork appears only in repo-cloud context (`cloudRepoBuild && !demoLetsBuild && cap.mode === 'remote'`); demo/local/flag-off unchanged.
- App/UI copy is **English**.

---

### Task 1: `sanitizeRepoName` (pure)

**Files:**

- Create: `lib/github/repoName.ts`
- Test: `lib/github/repoName.test.ts`

**Interfaces:**

- Produces: `sanitizeRepoName(raw: unknown): string | null` — trims; returns the name if it is 1–100 chars of `[A-Za-z0-9-_.]` only; else null.

- [ ] **Step 1: Write the failing test** — `lib/github/repoName.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sanitizeRepoName } from './repoName';

describe('sanitizeRepoName', () => {
  it('accepts a valid name (trimmed)', () => {
    expect(sanitizeRepoName('  my-app_2.0  ')).toBe('my-app_2.0');
    expect(sanitizeRepoName('Landing')).toBe('Landing');
  });
  it('rejects blank / whitespace', () => {
    expect(sanitizeRepoName('')).toBeNull();
    expect(sanitizeRepoName('   ')).toBeNull();
  });
  it('rejects bad characters and traversal-ish input', () => {
    for (const n of ['a b', 'a/b', '../x', 'a\\b', 'name!', 'a@b', 'x'.repeat(101)]) {
      expect(sanitizeRepoName(n)).toBeNull();
    }
  });
  it('rejects non-strings', () => {
    expect(sanitizeRepoName(null)).toBeNull();
    expect(sanitizeRepoName(42)).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run lib/github/repoName.test.ts` — FAIL.

- [ ] **Step 3: Implement** — `lib/github/repoName.ts`:

```ts
// Validate a repo name before creating it on GitHub. GitHub silently rewrites some names
// (spaces → hyphens, etc.); we reject up front so the created repo matches what the founder
// typed, and to keep the name safe as a path segment. Pure — unit-tested.
const RE = /^[A-Za-z0-9-_.]{1,100}$/;

export function sanitizeRepoName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  return RE.test(name) ? name : null;
}
```

- [ ] **Step 4: Run** `npx vitest run lib/github/repoName.test.ts` — PASS.

- [ ] **Step 5: Commit** — `git add lib/github/repoName.ts lib/github/repoName.test.ts && git commit -m "feat(github): sanitizeRepoName (validate before create)"`

---

### Task 2: GitHub HTTP — user-code exchange, create returns id, add-to-installation

**Files:**

- Modify: `lib/github/appAuth.ts` (add `exchangeUserCode`)
- Modify: `lib/github/repos.ts` (`createRepoFromTemplate` returns `id`; add `addRepoToInstallation`)

**Interfaces:**

- Produces: `exchangeUserCode(code: string): Promise<string | null>` (POST `https://github.com/login/oauth/access_token`); `createRepoFromTemplate(userToken, name): Promise<{ owner: string; name: string; id: number }>` (extended); `addRepoToInstallation(userToken: string, installationId: string, repoId: number): Promise<void>`.

> Integration I/O — verified by `npm run typecheck` + the route tests (Tasks 4/5 mock these) + manual E2E. No unit test. Security: never log/return tokens; throw with status only.

- [ ] **Step 1** `lib/github/appAuth.ts` — add:

```ts
/** Exchange a GitHub App user-to-server OAuth `code` for a (non-expiring) user access
 *  token. Returns null on any failure — the caller treats a missing token as "not able
 *  to create repos yet" rather than a hard error. Never logs the token. */
export async function exchangeUserCode(code: string): Promise<string | null> {
  try {
    const resp = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GITHUB_APP_CLIENT_ID,
        client_secret: process.env.GITHUB_APP_CLIENT_SECRET,
        code,
      }),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { access_token?: string };
    return data.access_token ?? null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2** `lib/github/repos.ts` — change `createRepoFromTemplate`'s parse + return to include `id`:

```ts
const data = (await resp.json()) as { owner: { login: string }; name: string; id: number };
return { owner: data.owner.login, name: data.name, id: data.id };
```

(and update its declared return type to `Promise<{ owner: string; name: string; id: number }>`.) Then add:

```ts
/** Add a just-created repo to the company's installation so an installation token can reach
 *  it (needed when the App is installed on "select" repos). Uses the USER token (adding a
 *  repo to an installation is a user action). Throws with status only on failure. */
export async function addRepoToInstallation(
  userToken: string,
  installationId: string,
  repoId: number,
): Promise<void> {
  const resp = await fetch(
    `https://api.github.com/user/installations/${installationId}/repositories/${repoId}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `token ${userToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (!resp.ok) throw new Error(`GitHub add-repo-to-installation failed: ${resp.status}`);
}
```

- [ ] **Step 3** `npm run typecheck` — clean. `npm run lint` — no new errors. `npm test` — still green (nothing consuming the changed return yet except the 501 stub, which doesn't call it).
- [ ] **Step 4** Commit — `git add lib/github/appAuth.ts lib/github/repos.ts && git commit -m "feat(github): exchangeUserCode + create returns id + addRepoToInstallation"`

---

### Task 3: Store the user token (`companyDataAdmin` + schema)

**Files:**

- Modify: `lib/firebase/schema.ts` (`github.userToken?`)
- Modify: `lib/firebase/companyDataAdmin.ts` (`setCompanyGithubUserToken`, `getCompanyGithubUserToken`)

**Interfaces:**

- Produces: `setCompanyGithubUserToken(companyId: string, userToken: string): Promise<void>`; `getCompanyGithubUserToken(companyId: string): Promise<string | null>`.

> Integration (admin I/O) — verified by typecheck + route tests. No unit test.

- [ ] **Step 1** `lib/firebase/schema.ts` — change `CompanyDoc.github` to `{ installationId: string; login: string; connectedAt: Millis; userToken?: string }`.
- [ ] **Step 2** `lib/firebase/companyDataAdmin.ts` — add (read `getCompanyGithub`/`setCompanyGithub` for the `adminDb().doc(paths.company(companyId))` pattern):

```ts
/** Store the GitHub App user access token for repo creation (server-only secret). */
export async function setCompanyGithubUserToken(
  companyId: string,
  userToken: string,
): Promise<void> {
  await adminDb().doc(paths.company(companyId)).set({ github: { userToken } }, { merge: true });
}

/** Read the stored GitHub user token, or null. Server-only. */
export async function getCompanyGithubUserToken(companyId: string): Promise<string | null> {
  const snap = await adminDb().doc(paths.company(companyId)).get();
  const t = snap.data()?.github?.userToken;
  return typeof t === 'string' && t ? t : null;
}
```

- [ ] **Step 3** `npm run typecheck` — clean. `npm test` — green.
- [ ] **Step 4** Commit — `git add lib/firebase/schema.ts lib/firebase/companyDataAdmin.ts && git commit -m "feat(github): store the App user token (server-only)"`

---

### Task 4: Callback exchanges the `code` → user token

**Files:**

- Modify: `app/api/github/callback/route.ts`
- Test: `app/api/github/callback/route.test.ts` (extend)

**Interfaces:**

- Consumes: `exchangeUserCode` (Task 2), `setCompanyGithubUserToken` (Task 3).

- [ ] **Step 1: Write the failing test** — extend `app/api/github/callback/route.test.ts` (`vi.mock('@/lib/github/appAuth')` for `exchangeUserCode`, `vi.mock('@/lib/firebase/companyDataAdmin')` for both setters). Assert: with a valid state + installation_id + a `code`, `exchangeUserCode(code)` is called and (on a returned token) `setCompanyGithubUserToken(companyId, token)` is called; when `exchangeUserCode` returns null (or there's no `code`), `setCompanyGithubUserToken` is NOT called but `setCompanyGithub` still IS (installation still binds) and the response is still a redirect. Keep the existing forged-state 401 / missing-installation 400 tests.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** — in the callback, after `setCompanyGithub(...)`: read `const code = searchParams.get('code');`; `if (code) { const userToken = await exchangeUserCode(code); if (userToken) await setCompanyGithubUserToken(st.companyId, userToken); }`. Do NOT block the redirect on token-exchange failure.

- [ ] **Step 4: Run** — PASS. `npm run typecheck` — clean.

- [ ] **Step 5: Commit** — `git add app/api/github/callback && git commit -m "feat(github): callback exchanges the OAuth code for a user token"`

---

### Task 5: Unstub `POST /api/github/repos` (create + add-to-installation)

**Files:**

- Modify: `app/api/github/repos/route.ts`
- Test: `app/api/github/repos/route.test.ts` (extend)

**Interfaces:**

- Consumes: `verifyIdToken`, `sanitizeRepoName` (Task 1), `getCompanyGithubUserToken` (Task 3), `getCompanyGithub`, `createRepoFromTemplate` + `addRepoToInstallation` (Task 2).

- [ ] **Step 1: Write the failing test** — replace the POST-501 test with: 401 without token; 400 `bad_request` on a name that fails `sanitizeRepoName`; 400 `reconnect_github` when `getCompanyGithubUserToken` → null; 200 `{repo}` on success (assert `createRepoFromTemplate(userToken, name)` + `addRepoToInstallation(userToken, installationId, repo.id)` both called); 422 `create_failed` when `createRepoFromTemplate` throws; 502 `coverage_failed` when `addRepoToInstallation` throws; and that the response body carries **no** token.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** the POST handler (remove the 501 stub + the `void createRepoFromTemplate`): verify token → `companyId=uid`; parse body; `const name = sanitizeRepoName(body?.name)` (400 `bad_request` if null); `const userToken = await getCompanyGithubUserToken(companyId)` (400 `reconnect_github` if null); `const gh = await getCompanyGithub(companyId)` (404 `not_connected` if null); `let repo; try { repo = await createRepoFromTemplate(userToken, name); } catch { → 422 create_failed }`; `try { await addRepoToInstallation(userToken, gh.installationId, repo.id); } catch { → 502 coverage_failed }`; return `{ repo: { owner: repo.owner, name: repo.name } }`.

- [ ] **Step 4: Run** — PASS. `npm run typecheck` — clean.

- [ ] **Step 5: Commit** — `git add app/api/github/repos && git commit -m "feat(github): create a repo from the template + add it to the installation"`

---

### Task 6: Store — the fork + `buildTarget` + `createProject`

**Files:**

- Modify: `lib/buildFlow.ts` (fork copy)
- Modify: `lib/store.tsx` (`buildTarget` state, fork in `startBuildIntake`, `createProject`, new `buildAction` kinds)

**Interfaces:**

- Consumes: `POST /api/github/repos`, `cloudBuildAuthHeader`, existing `startBuildIntake`/`armBuild`/`setBuildRepo`.
- Produces: `buildTarget: 'new' | 'existing' | null` + `setBuildTarget`; `createProject(name: string): Promise<void>`; the `ChatMessage.buildAction.kind` union gains `'target-new' | 'target-existing'`.

- [ ] **Step 1** `lib/buildFlow.ts` — add `export const FORK_PROMPT = "First up — are we starting a brand-new project, or adding to one you already have? 🌱";` (+ keep `INTAKE_OPENING`).
- [ ] **Step 2** `lib/store.tsx`:
  - Add `buildTarget` state (`'new'|'existing'|null`), reset to null in `startBuildIntake`.
  - Extend the `buildAction.kind` union type (search `kind:`) to add `'target-new' | 'target-existing'`.
  - In `startBuildIntake`: when the repo-cloud context is active (compute `cloudRepoBuild` is already module-scope; the context also needs remote+non-demo — read how the store knows demo/remote; if capability isn't readily available synchronously, gate the fork on `cloudRepoBuild && !demoLetsBuild` and let the arm step handle remote), post a **fork message** (`text: FORK_PROMPT`) carrying two actions rendered as buttons (a single message can carry the fork via a dedicated field, or post one message per button — simplest: reuse the `buildAction` single-button pattern twice is not possible on one message, so add a `forkActions?: true` marker or post the prompt with `buildAction` for one and rely on the UI to render both from a `fork: true` flag). **Chosen shape:** add `fork?: boolean` to `ChatMessage`; post one byte message `{ text: FORK_PROMPT, fork: true }`. The UI (Task 7) renders the two buttons for a `fork` message; clicking calls `chooseBuildTarget('new'|'existing')`.
  - Add `chooseBuildTarget(t)`: `setBuildTarget(t)`, strip the fork buttons, then post `INTAKE_OPENING` (start the brainstorm) — i.e. call the existing brainstorm-opening path.
  - When NOT repo-cloud context, `startBuildIntake` behaves exactly as today (post `INTAKE_OPENING`, no fork).
  - Add `createProject(name)`: `POST /api/github/repos` with `{ ...(await cloudBuildAuthHeader()) }` + `{ name }`; on 200 `setBuildRepo(res.repo)` then call `armBuild()`; on 400 `reconnect_github` → a "reconnect GitHub" byte message; on other non-ok → a friendly retry message. Expose `buildTarget`, `chooseBuildTarget`, `createProject` in the context value + type.
- [ ] **Step 3** `npm run typecheck && npm run lint` (no new errors) && `npm test` (green; report count).
- [ ] **Step 4** Commit — `git add lib/buildFlow.ts lib/store.tsx && git commit -m "feat(build): New/Existing fork + buildTarget + createProject"`

---

### Task 7: UI — fork buttons + new-project name input

**Files:**

- Modify: `components/Copilot.tsx`

**Interfaces:**

- Consumes: `fork`-flagged messages + `chooseBuildTarget` (Task 6); `buildTarget` + `createProject` (Task 6); the existing repo selector for `buildTarget==='existing'`.

- [ ] **Step 1** In the chat message renderer, when `m.fork` is set, render the prompt text + two buttons **"✨ New project"** (`onClick={() => chooseBuildTarget('new')}`) and **"🔧 Existing project"** (`onClick={() => chooseBuildTarget('existing')}`), styled like the other in-chat action buttons (`bub-act`).
- [ ] **Step 2** In the `start-building` block: for a repo-cloud build, branch on `buildTarget`:
  - `'existing'` → the existing repo selector (unchanged).
  - `'new'` → a small form: a **project-name `<input>`** + a **"Create & build"** button that calls `createProject(name.trim())` (disabled when blank or while creating). Show a hint that a Next.js project will be created.
- [ ] **Step 3** `npm run typecheck && npm run lint && npm run format:check` clean; `npm test` green.
- [ ] **Step 4** Commit — `git add components/Copilot.tsx && git commit -m "feat(build): fork buttons + new-project name input"`

---

## Self-Review

- **Spec coverage:** §A callback code-exchange → Tasks 2,4. §B storage → Task 3. §C create (sanitize, user token, create, add-to-installation, error codes) → Tasks 1,2,5. §D fork UI + flows → Tasks 6,7. Credit/security (free create, user token server-only, companyId=uid) → Tasks 3,5,6. Error handling (400/422/502/reconnect) → Task 5; fork-ignored → Task 6. Testing list → each task. Out-of-scope items not implemented (correct).
- **Placeholder scan:** every code step carries real code or a precise mirror-this pointer to a named file; the integration tasks (2,3) are external I/O verified by typecheck + route mocks + manual E2E, not fabricated.
- **Type consistency:** `sanitizeRepoName → string|null` (Task 1) used in the repos POST (5). `createRepoFromTemplate → {owner,name,id}` (Task 2) consumed by the POST route (5, for `repo.id`) and `addRepoToInstallation(userToken, installationId, repoId)` (2→5). `exchangeUserCode → string|null` (2) used by the callback (4). `getCompanyGithubUserToken → string|null` (3) used by the POST route (5). `buildTarget: 'new'|'existing'|null` + `chooseBuildTarget`/`createProject` (6) consumed by the UI (7). `buildAction.kind` union + `fork` flag on `ChatMessage` (6) rendered by the UI (7). The `github.userToken?` schema field (3) written by `setCompanyGithubUserToken` (3) + the callback (4), read by `getCompanyGithubUserToken` (3).

## Notes on external dependencies (cannot be E2E'd without setup)

Tasks 1, 4, 5 are unit/mock-tested in-repo. The full connect→create→build flow needs: the GitHub App configured with **"Request user authorization (OAuth) during installation"** + **non-expiring** user tokens + `GITHUB_APP_CLIENT_ID/SECRET`; the **`codepet-templates/starter`** template repo (Next.js) on the Codepet org; and everything from GitHub-backed cloud build (App registration, E2B, keys, flag). That E2E is manual, done by the user.
