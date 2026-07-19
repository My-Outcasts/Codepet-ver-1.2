# GitHub-backed cloud build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A founder builds into their real GitHub repo from Codepet, in the cloud on company credits — connect/create a repo, describe a change, and an E2B sandbox clones the repo, runs `claude`, and pushes a branch + opens a PR.

**Architecture:** Reuse the #152 cloud-build foundation (E2B boot, self-report → `liveBuilds/{id}` → browser subscribe, credit gate + transactional charge, ingest auth). Add a GitHub App (installation tokens for git ops, a user token for repo-create), a repo-aware sandbox script (clone → branch → claude → push → PR), an ownership guard, and a repo selector. Watch-only, one-shot; result is a PR.

**Tech Stack:** Next.js (Node routes), React, TypeScript, Firebase Admin, E2B (`e2b`), `jsonwebtoken` (App JWT), GitHub REST API via `fetch`, Vitest.

## Global Constraints

- Result is a **branch** `codepet/<buildSessionId>` + a **PR**. Never modify `main`.
- Credit: flat **5/build** (reuse `creditCostForRoute('build')`), charged only on a **successful push**. Per-build token cap **3_000_000** (`REPO_BUILD_TOKEN_CAP`).
- `companyId` is always the verified Firebase `uid` — **never** from a request body (the #152 IDOR fix).
- **Ownership guard:** the target repo must be in the company's GitHub installation's repo list.
- Secrets **server-only**, never returned to the client: `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_SECRET`, the minted installation/user tokens, company `ANTHROPIC_API_KEY`, `E2B_API_KEY`, the ingest token.
- Installation token is **short-lived + scoped to the one target repo**, passed to the sandbox via env.
- Client path behind flag `NEXT_PUBLIC_CLOUD_REPO_BUILD` (default OFF).
- App/UI copy is **English**.
- Store the App link on the company doc: `github: { installationId: string; login: string; connectedAt: number }`.

---

### Task 1: Signed `state` for the connect flow

**Files:**

- Create: `lib/github/state.ts`
- Test: `lib/github/state.test.ts`

**Interfaces:**

- Produces: `signState(payload: { companyId: string; nonce: string }): string`; `verifyState(raw: unknown): { companyId: string; nonce: string } | null`. HMAC-SHA256 over the JSON with `GITHUB_STATE_SECRET`; tamper/format failures → null.

- [ ] **Step 1: Write the failing test** — `lib/github/state.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { signState, verifyState } from './state';

beforeEach(() => {
  process.env.GITHUB_STATE_SECRET = 'test-secret';
});

describe('github state', () => {
  it('round-trips a signed state', () => {
    const s = signState({ companyId: 'co1', nonce: 'n1' });
    expect(verifyState(s)).toEqual({ companyId: 'co1', nonce: 'n1' });
  });
  it('rejects a tampered payload', () => {
    const s = signState({ companyId: 'co1', nonce: 'n1' });
    const [body, sig] = s.split('.');
    const forged = Buffer.from(JSON.stringify({ companyId: 'evil', nonce: 'n1' })).toString(
      'base64url',
    );
    expect(verifyState(`${forged}.${sig}`)).toBeNull();
    expect(verifyState(`${body}.deadbeef`)).toBeNull();
  });
  it('returns null for malformed input', () => {
    expect(verifyState(null)).toBeNull();
    expect(verifyState('nope')).toBeNull();
    expect(verifyState('a.b.c')).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run lib/github/state.test.ts` — FAIL (module missing).

- [ ] **Step 3: Implement** — `lib/github/state.ts`:

```ts
// A tamper-proof `state` param for the GitHub App connect redirect: it carries the
// companyId across GitHub's install page and back to /api/github/callback. HMAC-signed
// with GITHUB_STATE_SECRET so a caller can't forge which company an installation binds to.
import { createHmac, timingSafeEqual } from 'node:crypto';

function secret(): string {
  return process.env.GITHUB_STATE_SECRET ?? '';
}
function sign(body: string): string {
  return createHmac('sha256', secret()).update(body).digest('base64url');
}

export function signState(payload: { companyId: string; nonce: string }): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifyState(raw: unknown): { companyId: string; nonce: string } | null {
  if (typeof raw !== 'string') return null;
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const obj = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (obj && typeof obj.companyId === 'string' && typeof obj.nonce === 'string') {
      return { companyId: obj.companyId, nonce: obj.nonce };
    }
    return null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run** `npx vitest run lib/github/state.test.ts` — PASS.

- [ ] **Step 5: Commit** — `git add lib/github/state.ts lib/github/state.test.ts && git commit -m "feat(github): signed state for the App connect flow"`

---

### Task 2: Repo-ownership guard (pure)

**Files:**

- Create: `lib/github/repos.ts` (guard now; HTTP fns added in Task 7)
- Test: `lib/github/repos.test.ts`

**Interfaces:**

- Produces: `interface RepoRef { owner: string; name: string }`; `repoInInstallation(repos: RepoRef[], target: RepoRef): boolean` — case-insensitive match; the security guard that a founder can only build into a repo their installation covers.

- [ ] **Step 1: Write the failing test** — `lib/github/repos.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { repoInInstallation } from './repos';

const list = [
  { owner: 'acme', name: 'web' },
  { owner: 'acme', name: 'api' },
];

describe('repoInInstallation', () => {
  it('accepts a repo in the list (case-insensitive)', () => {
    expect(repoInInstallation(list, { owner: 'acme', name: 'web' })).toBe(true);
    expect(repoInInstallation(list, { owner: 'ACME', name: 'WEB' })).toBe(true);
  });
  it('rejects a repo not in the list', () => {
    expect(repoInInstallation(list, { owner: 'acme', name: 'secret' })).toBe(false);
    expect(repoInInstallation(list, { owner: 'evil', name: 'web' })).toBe(false);
  });
  it('rejects malformed targets', () => {
    expect(repoInInstallation(list, { owner: '', name: 'web' })).toBe(false);
    expect(repoInInstallation([], { owner: 'acme', name: 'web' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run lib/github/repos.test.ts` — FAIL.

- [ ] **Step 3: Implement** — `lib/github/repos.ts`:

```ts
// GitHub repo helpers for cloud builds. The pure ownership guard is the security boundary:
// a founder may only build into a repo their App installation actually covers. (HTTP list/
// create functions are added in a later task; this file starts with the guard.)

export interface RepoRef {
  owner: string;
  name: string;
}

/** Case-insensitive membership: is `target` one of the installation's repos? */
export function repoInInstallation(repos: RepoRef[], target: RepoRef): boolean {
  if (!target.owner || !target.name) return false;
  const key = (r: RepoRef) => `${r.owner.toLowerCase()}/${r.name.toLowerCase()}`;
  const want = key(target);
  return repos.some((r) => key(r) === want);
}
```

- [ ] **Step 4: Run** `npx vitest run lib/github/repos.test.ts` — PASS.

- [ ] **Step 5: Commit** — `git add lib/github/repos.ts lib/github/repos.test.ts && git commit -m "feat(github): repoInInstallation ownership guard"`

---

### Task 3: App JWT claims (pure)

**Files:**

- Create: `lib/github/appAuth.ts` (claims builder now; token exchange added in Task 7)
- Test: `lib/github/appAuth.test.ts`

**Interfaces:**

- Produces: `appJwtClaims(appId: string, nowSec: number): { iss: string; iat: number; exp: number }` — GitHub App JWT claims (`iat` backdated 60s for clock skew, `exp` +9min, per GitHub's 10-min max).

- [ ] **Step 1: Write the failing test** — `lib/github/appAuth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { appJwtClaims } from './appAuth';

describe('appJwtClaims', () => {
  it('backdates iat 60s and sets exp within GitHub 10-min max', () => {
    const now = 1_000_000;
    const c = appJwtClaims('123', now);
    expect(c.iss).toBe('123');
    expect(c.iat).toBe(now - 60);
    expect(c.exp).toBe(now + 540); // 9 minutes
    expect(c.exp - c.iat).toBeLessThan(600);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run lib/github/appAuth.test.ts` — FAIL.

- [ ] **Step 3: Implement** — `lib/github/appAuth.ts`:

```ts
import 'server-only';
import jwt from 'jsonwebtoken';

/** GitHub App JWT claims. iat backdated 60s (clock skew); exp +9min (GitHub caps at 10). */
export function appJwtClaims(
  appId: string,
  nowSec: number,
): { iss: string; iat: number; exp: number } {
  return { iss: appId, iat: nowSec - 60, exp: nowSec + 540 };
}

/** Sign the App JWT (RS256) from env — the credential used to mint installation tokens. */
export function appJwt(nowSec: number): string {
  const key = (process.env.GITHUB_APP_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  return jwt.sign(appJwtClaims(process.env.GITHUB_APP_ID ?? '', nowSec), key, {
    algorithm: 'RS256',
  });
}
```

> `appJwt` isn't unit-tested (needs a real RSA key + is time/env-bound); it's exercised in the manual E2E. The pure `appJwtClaims` carries the logic worth testing.

- [ ] **Step 4: Run** `npx vitest run lib/github/appAuth.test.ts` — PASS. Then `npm run typecheck` — clean.

- [ ] **Step 5: Commit** — `git add lib/github/appAuth.ts lib/github/appAuth.test.ts && git commit -m "feat(github): App JWT claims + signer"`

---

### Task 4: `repoBuildScript` (pure sandbox launcher)

**Files:**

- Create: `lib/build/repoBuildScript.ts`
- Test: `lib/build/repoBuildScript.test.ts`

**Interfaces:**

- Consumes: nothing (pure). Mirrors `lib/build/cloudBuildScript.ts`.
- Produces: `interface RepoBuildInput { openingPrompt: string; apiUrl: string; companyId: string; ingestToken: string; buildSessionId: string; repo: { owner: string; name: string }; installToken: string; tokenCap?: number }`; `repoBuildScript(input: RepoBuildInput): string`; `REPO_BUILD_TOKEN_CAP = 3_000_000`.

- [ ] **Step 1: Write the failing test** — `lib/build/repoBuildScript.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { repoBuildScript, REPO_BUILD_TOKEN_CAP } from './repoBuildScript';

const base = {
  openingPrompt: "Let's build: add a contact form",
  apiUrl: 'https://app.codepet.com',
  companyId: 'co1',
  ingestToken: 'ingest-123',
  buildSessionId: 'b-9',
  repo: { owner: 'acme', name: 'web' },
  installToken: 'ghs_installtoken',
};

describe('repoBuildScript', () => {
  it('clones the repo, branches, runs claude watch-only, self-reports, finalizes', () => {
    const s = repoBuildScript(base);
    expect(s).toContain('git clone');
    expect(s).toContain('acme/web');
    expect(s).toContain('codepet/b-9'); // the branch
    expect(s).toContain('--permission-mode bypassPermissions');
    expect(s).toContain('/api/track/live');
    expect(s).toContain('/api/build/repo-finalize');
    expect(s).toContain('ingest-123');
    expect(s).toContain(String(REPO_BUILD_TOKEN_CAP));
    expect(s).toContain('trap');
  });
  it('passes the install token via env, never claude/anthropic keys inline', () => {
    const s = repoBuildScript(base);
    expect(s).toContain('ghs_installtoken');
    expect(s).not.toContain('ANTHROPIC_API_KEY=');
    expect(s).not.toContain('GITHUB_APP_PRIVATE_KEY');
  });
});
```

- [ ] **Step 2: Run** `npx vitest run lib/build/repoBuildScript.test.ts` — FAIL.

- [ ] **Step 3: Implement** — `lib/build/repoBuildScript.ts`. Model it on `lib/build/cloudBuildScript.ts` (read it for the `shq` quoting + env-export style). Clone via `https://x-access-token:${installToken}@github.com/owner/name.git`, branch `codepet/<buildSessionId>`, run `$CODEPET_CLAUDE_CMD "$CODEPET_OPENING_PROMPT"`, self-report to `${apiUrl}/api/track/live`, cap tokens at `REPO_BUILD_TOKEN_CAP`, commit + push, then the runner opens the PR and POSTs `${apiUrl}/api/build/repo-finalize`. Keep the actual git/claude/PR execution in the sandbox's `cloud-run.mjs` runner (env-driven, per `docs/e2b-template.md`); this builder only emits the launcher + the `CODEPET_*` env (including `CODEPET_REPO`, `CODEPET_BRANCH`, `CODEPET_INSTALL_TOKEN`, `CODEPET_FINALIZE_PATH=/api/build/repo-finalize`, `CODEPET_TOKEN_CAP`). Reuse `shq`; never embed the App private key or a literal `ANTHROPIC_API_KEY=` (that comes from sandbox env).

- [ ] **Step 4: Run** `npx vitest run lib/build/repoBuildScript.test.ts` — PASS.

- [ ] **Step 5: Commit** — `git add lib/build/repoBuildScript.ts lib/build/repoBuildScript.test.ts && git commit -m "feat(build): repoBuildScript (clone → branch → claude → push → PR)"`

---

### Task 5: `LiveState.prUrl` + `repo` carried through `reduceLive`

**Files:**

- Modify: `lib/liveBuild.ts`
- Test: `lib/liveBuild.test.ts`

**Interfaces:**

- Produces: `LiveState.prUrl?: string`, `LiveState.repo?: { owner: string; name: string }` — durable per-build fields carried through `reduceLive`'s `start` branch, exactly like `previewUrl`/`mode`/`companyId`.

- [ ] **Step 1: Write the failing test** — append to `lib/liveBuild.test.ts`:

```ts
import { reduceLive, initialLive } from './liveBuild';

describe('prUrl + repo survive live events', () => {
  it('carries prUrl and repo through a start reset', () => {
    const s = { ...initialLive(0), prUrl: 'https://gh/pr/1', repo: { owner: 'acme', name: 'web' } };
    const next = reduceLive(s, { buildSessionId: 'b1', sessionId: 's', kind: 'start', ts: 1 });
    expect(next.prUrl).toBe('https://gh/pr/1');
    expect(next.repo).toEqual({ owner: 'acme', name: 'web' });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run lib/liveBuild.test.ts` — FAIL.

- [ ] **Step 3: Implement** — in `lib/liveBuild.ts`: add `prUrl?: string;` and `repo?: { owner: string; name: string };` to `LiveState`; in `reduceLive`'s `start` branch (which already preserves `mode`/`companyId`/`previewUrl`), also carry `prUrl: state?.prUrl` and `repo: state?.repo` via the same `prune({ ...fresh, ... })`.

- [ ] **Step 4: Run** `npx vitest run lib/liveBuild.test.ts` — PASS.

- [ ] **Step 5: Commit** — `git add lib/liveBuild.ts lib/liveBuild.test.ts && git commit -m "feat(build): LiveState.prUrl + repo carried through reduceLive"`

---

### Task 6: `finalizeRepoBuild` (record PR + charge, idempotent)

**Files:**

- Create: `lib/build/repoFinalize.ts`
- Test: `lib/build/repoFinalize.test.ts` (transaction-mocked, mirrors `lib/build/cloudStore.finalize.test.ts`)

**Interfaces:**

- Consumes: `adminDb`, `paths.liveBuild`, `creditCostForRoute`.
- Produces: `finalizeRepoBuild(args: { companyId: string; buildSessionId: string; status: 'ok' | 'error'; tokens: number; prUrl?: string; branch?: string; pushed: boolean }): Promise<{ ok: boolean; reason?: 'no_such_build' | 'already_ended' }>`.

Behavior (mirror `cloudStore.finalizeBuild`): a `runTransaction` reads `liveBuild(companyId, buildSessionId)` — missing → `no_such_build`; `ended===true` → `already_ended`; else claim by setting `{ ended: true, tokens, ...(prUrl?{prUrl}:{}) , ...(branch?{branch}:{}) }`. **Charge 5 credits only when `status==='ok' AND pushed===true`** (a successful push landed real work) — increment `route.build.calls` on `companies/{companyId}/usage/{yyyy-mm-dd}`.

- [ ] **Step 1: Write the failing test** — model it on `lib/build/cloudStore.finalize.test.ts` (read it for the `runTransaction` + admin mock harness). Assert: no live doc → `no_such_build`, no charge; `ended:true` → `already_ended`, no charge; `status:'ok'` + `pushed:true` → claim written with `prUrl` + charge once; `status:'ok'` + `pushed:false` → claim written, **no charge**; `status:'error'` → **no charge**.

- [ ] **Step 2: Run** `npx vitest run lib/build/repoFinalize.test.ts` — FAIL.

- [ ] **Step 3: Implement** `lib/build/repoFinalize.ts` per the behavior above, reusing the `ymd()` day-key convention and `FieldValue.increment(1)` from `lib/build/cloudStore.ts` (read it).

- [ ] **Step 4: Run** `npx vitest run lib/build/repoFinalize.test.ts` — PASS. `npm run typecheck` — clean.

- [ ] **Step 5: Commit** — `git add lib/build/repoFinalize.ts lib/build/repoFinalize.test.ts && git commit -m "feat(build): finalizeRepoBuild (record PR, charge on successful push, idempotent)"`

---

### Task 7: GitHub HTTP client (installation token, list, create) + admin company.github helpers

**Files:**

- Modify: `lib/github/appAuth.ts` (add `installationToken`), `lib/github/repos.ts` (add `listInstallationRepos`, `createRepoFromTemplate`)
- Modify: `lib/firebase/schema.ts` (add `github` to `CompanyDoc`)
- Modify: `lib/firebase/companyDataAdmin.ts` (add `setCompanyGithub`, `getCompanyGithub`)

**Interfaces:**

- Produces: `installationToken(installationId: string, repos: string[]): Promise<string>` (POST `/app/installations/{id}/access_tokens` with `repositories`, App-JWT auth); `listInstallationRepos(installationId: string): Promise<RepoRef[]>`; `createRepoFromTemplate(userToken: string, name: string): Promise<RepoRef>`; `setCompanyGithub(companyId, { installationId, login })`; `getCompanyGithub(companyId): Promise<{ installationId: string; login: string } | null>`.

> Integration code — verified by `npm run typecheck` + the route tests (Tasks 8–11) that mock these, and manual E2E. No unit test (all are `fetch`/admin I/O). Use `fetch` with `Authorization: Bearer <appJwt>` / `token <installToken>`, `Accept: application/vnd.github+json`.

- [ ] **Step 1** Add `github?: { installationId: string; login: string; connectedAt: Millis }` to `CompanyDoc` (`lib/firebase/schema.ts`), after `ingestToken`.
- [ ] **Step 2** Implement `installationToken`, `listInstallationRepos`, `createRepoFromTemplate` in the github lib (App-JWT via `appJwt(Math.floor(Date.now()/1000))`).
- [ ] **Step 3** Implement `setCompanyGithub`/`getCompanyGithub` in `companyDataAdmin.ts` via `adminDb().doc(paths.company(companyId))`.
- [ ] **Step 4** `npm run typecheck` — clean. `npm run lint` — no new errors.
- [ ] **Step 5** Commit — `git add lib/github lib/firebase/schema.ts lib/firebase/companyDataAdmin.ts && git commit -m "feat(github): installation token + repo list/create + company.github helpers"`

---

### Task 8: `GET /api/github/callback` (bind installation to company)

**Files:**

- Create: `app/api/github/callback/route.ts`
- Test: `app/api/github/callback/route.test.ts`

**Interfaces:**

- Consumes: `verifyState` (Task 1), `setCompanyGithub` (Task 7).
- Produces: `GET` — reads `installation_id` + `state` from the query; `verifyState(state)` (401 on bad signature); `setCompanyGithub(companyId, { installationId, login })`; redirect to `/` (or a "connected" page). 400 if `installation_id` missing.

- [ ] **Step 1: Write the failing test** — mock `@/lib/github/state` + `@/lib/firebase/companyDataAdmin`. Assert: bad `state` → 401 and `setCompanyGithub` NOT called; missing `installation_id` → 400; valid → `setCompanyGithub('co1', ...)` called with the verified companyId and a redirect (3xx) response.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** the route (`runtime='nodejs'`). **Step 4:** PASS + typecheck. **Step 5:** `git add app/api/github/callback && git commit -m "feat(github): /api/github/callback binds installation to the verified company"`

---

### Task 9: `GET/POST /api/github/repos` (list + create)

**Files:**

- Create: `app/api/github/repos/route.ts`
- Test: `app/api/github/repos/route.test.ts`

**Interfaces:**

- Consumes: `verifyIdToken`, `getCompanyGithub`, `listInstallationRepos`, `createRepoFromTemplate`.
- Produces: `GET` → verify Firebase token → companyId=uid → `getCompanyGithub` (404 `{error:'not_connected'}` if none) → `listInstallationRepos` → `{ repos }`. `POST { name }` → create a repo from the starter template via the user token → `{ repo }`.

- [ ] **Step 1: Write the failing test** — mock the github lib + auth. Assert: 401 without token; 404 `not_connected` when the company has no `github`; 200 `{repos}` on GET; 200 `{repo}` on POST create.
- [ ] **Step 2–5** FAIL → implement (`runtime='nodejs'`) → PASS + typecheck → commit `feat(github): /api/github/repos list + create`.

---

### Task 10: `POST /api/build/repo-start` (gate + ownership + mint + boot)

**Files:**

- Create: `app/api/build/repo-start/route.ts`
- Test: `app/api/build/repo-start/route.test.ts`

**Interfaces:**

- Consumes: `verifyIdToken`, `loadPeriodCreditsAdmin`, `canAffordBuild`, `PRO_INCLUDED_CREDITS`, `getCompanyGithub`, `listInstallationRepos`, `repoInInstallation`, `installationToken`, `ensureIngestTokenAdmin`, `repoBuildScript`, `startCloudBuild`, `adminDb`, `paths.liveBuild(s)`.
- Produces: `POST { repo: { owner, name }, plan, brief }` → `{ buildSessionId }` (200) or 401/402(`no_credits`)/403(`repo_not_owned`)/404(`not_connected`)/409(`build_in_progress`)/503(`not_configured`)/502(`boot_failed`).

Mirror `app/api/build/cloud-start/route.ts` (read it) with these additions, in order: verify token → `companyId=uid`; require `E2B_API_KEY`+`ANTHROPIC_API_KEY`+`GITHUB_APP_ID`+`GITHUB_APP_PRIVATE_KEY` (503); validate `repo` (400); credit gate (402); `getCompanyGithub` (404 not_connected); `listInstallationRepos` + `repoInInstallation` guard (403); single-flight over `paths.liveBuilds(companyId)` for an un-ended `mode:'repo'` build (409); `installationToken(installationId, [\`${owner}/${name}\`])`; `ensureIngestTokenAdmin`; `buildSessionId`; `repoBuildScript({...})`; `startCloudBuild({ script, anthropicKey })`(502 on throw); write`liveBuilds/{id}` `{ companyId, mode:'repo', repo, ended:false, startedAt }`; return `{ buildSessionId }`. Never return any token.

- [ ] **Step 1: Write the failing test** — mock `@/lib/build/cloudSandbox`, `@/lib/firebase/admin`, `@/lib/firebase/companyDataAdmin`, `@/lib/github/*`. Assert: 401 no token; 503 missing env; 402 gate; 404 not_connected; **403 when the repo isn't in the installation** (ownership guard — a key security test); 409 single-flight; 200 + `startCloudBuild` called + initial `mode:'repo'` doc written; the response body carries **no** install/ingest token.
- [ ] **Step 2–5** FAIL → implement → PASS + typecheck → commit `feat(build): /api/build/repo-start (gate, ownership guard, mint install token, boot)`.

---

### Task 11: `POST /api/build/repo-finalize` (ingest auth → record PR → charge)

**Files:**

- Create: `app/api/build/repo-finalize/route.ts`
- Test: `app/api/build/repo-finalize/route.test.ts`

**Interfaces:**

- Consumes: ingest-token auth (copy from `app/api/build/cloud-finalize/route.ts`), `finalizeRepoBuild` (Task 6).
- Produces: `POST { companyId, token, buildSessionId, status, tokens, prUrl?, branch?, pushed }` → maps `finalizeRepoBuild` result: `no_such_build`→404, `already_ended`→200, ok→200; 401 bad ingest token; 400 missing fields.

- [ ] **Step 1: Write the failing test** — mock `finalizeRepoBuild` + the company-doc read. Assert: 401 on wrong ingest token; 404 `no_such_build`; 200 idempotent `already_ended`; 200 + `finalizeRepoBuild` called with `status:'ok', pushed:true, prUrl` on success; `status:'error'` passed through (no charge — enforced in Task 6).
- [ ] **Step 2–5** FAIL → implement → PASS + typecheck → commit `feat(build): /api/build/repo-finalize (ingest auth, record PR, charge)`.

---

### Task 12: Store — `armBuild` repo-cloud branch + flag + repo state

**Files:**

- Modify: `lib/store.tsx`

**Interfaces:**

- Consumes: `POST /api/build/repo-start`, `GET /api/github/repos`, `getCompanyGithub` (via a client fetch), `cloudBuildAuthHeader`.
- Produces: a repo-cloud branch in `armBuild`; `buildRepo` state (the selected `{owner,name}`); a `connectGithub()` action (redirect to the App install URL with the signed state via a small `/api/github/connect` helper or a server action); `githubConnected` flag.

- [ ] **Step 1** Add `const cloudRepoBuild = process.env.NEXT_PUBLIC_CLOUD_REPO_BUILD === '1';` (module scope, next to `cloudDemoBuild`). Add `buildRepo` state + a getter for the connected repos.
- [ ] **Step 2** In `armBuild`, add a branch chosen when `cloudRepoBuild && !demoLetsBuild && cap.mode === 'remote'`: if GitHub isn't connected → post a byte "Connect GitHub to build in the cloud" message with a connect action; else `POST /api/build/repo-start` with `{ repo: buildRepo, plan: buildPlan, brief: buildBrief }` (**no companyId**), handling 402/403/404/409 with friendly messages, and on 200 set the non-local build state + `buildSessionId` so `subscribeLiveBuild` streams it (mirror the `cloudDemoBuild` branch).
- [ ] **Step 3** `npm run typecheck && npm run lint` (no new errors) && `npm test` (green). Report the count.
- [ ] **Step 4** Commit — `git add lib/store.tsx && git commit -m "feat(build): armBuild repo-cloud branch (flagged) — build into a GitHub repo"`

---

### Task 13: UI — repo selector, Connect GitHub, "View the pull request →"

**Files:**

- Modify: `components/Copilot.tsx` (the `start-building` block: repo selector for the repo-cloud path), `components/views/BuildCoachView.tsx` (END recap: PR link)

**Interfaces:**

- Consumes: `buildRepo`/repo list + `connectGithub()` from the store (Task 12); `buildLive.prUrl` (Task 5).

- [ ] **Step 1** In the `start-building` block, when it's a repo-cloud build, render **"Build into: [repo ▾]"** (populated from `GET /api/github/repos`) + a "Connect GitHub / Create new" affordance, instead of the demo notice / local project picker.
- [ ] **Step 2** In `BuildCoachView` `EndStep`, when `buildLive?.prUrl` is set, show **"View the pull request →"** linking to it (alongside/replacing the demo "Open your demo page").
- [ ] **Step 3** `npm run typecheck && npm run lint && npm run format:check` clean; `npm test` green.
- [ ] **Step 4** Commit — `git add components && git commit -m "feat(build): repo selector + Connect GitHub + PR link in the recap"`

---

### Task 14: Config + docs (App registration, env, template runner)

**Files:**

- Modify: `.env.example` (add the GitHub vars + the repo flag), `docs/e2b-template.md` (extend the runner for the repo build)

**Interfaces:** none (config/docs).

- [ ] **Step 1** Add to `.env.example`: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_STATE_SECRET`, `# NEXT_PUBLIC_CLOUD_REPO_BUILD=1` (commented, default off).
- [ ] **Step 2** Extend `docs/e2b-template.md`: the `cloud-run.mjs` runner must, for a repo build, honor `CODEPET_REPO`, `CODEPET_BRANCH`, `CODEPET_INSTALL_TOKEN`, `CODEPET_FINALIZE_PATH=/api/build/repo-finalize`, `CODEPET_TOKEN_CAP`; clone via `https://x-access-token:$CODEPET_INSTALL_TOKEN@github.com/$CODEPET_REPO.git`, branch, run claude, commit/push, open a PR (GitHub API with the same token), and POST `{ companyId, token, buildSessionId, status, tokens, prUrl, branch, pushed }` to the finalize path. Document a doc on **registering the "Codepet Builder" GitHub App** (permissions Contents:write, Pull requests:write, Metadata:read; callback URL `/api/github/callback`).
- [ ] **Step 3** `npm run format:check` clean.
- [ ] **Step 4** Commit — `git add .env.example docs/e2b-template.md && git commit -m "docs(github): App registration + env + repo runner"`

---

## Self-Review

- **Spec coverage:** §A App → Tasks 3,7,14. §B connect/list/create → Tasks 1,8,9. §C build flow → Tasks 4,10,11 (+ runner in 14). §D store/UI → Tasks 5,12,13. Credit+security (gate, ownership guard, short-lived scoped token, branch-only, companyId=uid) → Tasks 2,6,10. Error handling (402/403/404/409/502, no-charge on error/no-push, clone/push failures) → Tasks 6,10,11. Testing list → each task. Out-of-scope items are not implemented (correct).
- **Placeholder scan:** every code step carries real code or a precise mirror-this pointer to a named existing file; no TBD/TODO. The two integration areas with the most "mirror X" direction (Tasks 7, 14) are I/O against external services and are correctly verified by mocks + manual E2E, not fabricated code.
- **Type consistency:** `RepoRef {owner,name}` (Task 2) used by `repoInInstallation` (2,10), `repoBuildScript` (4), `LiveState.repo` (5), repo-start/finalize (10,11), store/UI (12,13). `finalizeRepoBuild` result `{ok, reason}` (6) consumed by repo-finalize (11). `REPO_BUILD_TOKEN_CAP=3_000_000` (4). `mode:'repo'` written in repo-start (10), matched by the single-flight filter (10) and the store branch (12). Flag `NEXT_PUBLIC_CLOUD_REPO_BUILD` (12,14). `companyId=uid` everywhere (10,11).

## Notes on external dependencies (cannot be E2E'd without setup)

Tasks 1–6, 8–11 are unit/mock-tested in-repo. The GitHub App must be **registered** (an out-of-repo one-time setup) and its keys + `E2B_API_KEY` + company `ANTHROPIC_API_KEY` + `GITHUB_STATE_SECRET` set, plus the E2B template runner extended (Task 14), before the full connect → clone → build → PR flow runs end-to-end. That E2E is manual, done by the user.
