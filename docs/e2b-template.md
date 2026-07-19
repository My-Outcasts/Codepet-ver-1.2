# E2B build template: `codepet-build`

This is the sandbox image `lib/build/cloudSandbox.ts` (`startCloudBuild`) boots via
`Sandbox.create('codepet-build', …)`. It is **not built by app code** — build it once
(and whenever the runner changes) with the E2B CLI and push it under this name/alias so
`Sandbox.create` can resolve it by template name.

## Base image

- Any Linux base with **Node ≥ 20** (the runner uses `readline` over the child's stdout, the
  global `fetch`, and `child_process` — nothing exotic, just modern Node). The canonical
  runner source lives in the repo at `e2b/codepet-build/` (see its README); build the template
  from there.
- Install the Claude Code CLI globally so `claude` is on `PATH`:
  ```sh
  npm i -g @anthropic-ai/claude-code
  ```
- Copy the runner script into the image at `/home/user/cloud-run.mjs` (source below).
- No other project files are baked in — `cloudBuildScript` (`lib/build/cloudBuildScript.ts`)
  seeds `index.html` into the demo dir itself at launch time, and `cloud-run.mjs` is the
  only sandbox-resident code.

### E2B CLI sketch

```sh
e2b template build --name codepet-build --dockerfile ./Dockerfile
```

Where `Dockerfile` does roughly:

```dockerfile
FROM node:20-slim
RUN npm i -g @anthropic-ai/claude-code
COPY cloud-run.mjs /home/user/cloud-run.mjs
```

## What the launcher does before the runner starts

`cloudBuildScript` (Task 3) writes a bash script that `startCloudBuild` uploads to
`/home/user/launch.sh` and runs detached (`nohup bash launch.sh >/tmp/build.log 2>&1 &`,
via `sandbox.commands.run(cmd, { background: true })`). That script:

1. `mkdir -p` the demo dir and seeds `index.html` if missing.
2. Exports the runner's entire configuration as env vars (never argv, so nothing leaks
   into `ps` for other tenants sharing sandbox infra):
   - `CODEPET_API_URL` — base URL of the Codepet app (e.g. `https://app.codepet.ai`).
   - `CODEPET_COMPANY_ID` — the company this build belongs to.
   - `CODEPET_INGEST_TOKEN` — the company's per-tenant ingest token (same one
     `/api/track/live` and `/api/track` already check against the company doc).
   - `CODEPET_BUILD_SESSION_ID` — id correlating this build's live events + finalize post.
   - `CODEPET_TOKEN_CAP` — max total tokens (input + output + cache) before the runner
     kills `claude` (see `BUILD_TOKEN_CAP` in `lib/build/cloudBuildScript.ts`, currently
     1,500,000; `startCloudBuild` also sets this as a sandbox env var directly).
   - `CODEPET_OPENING_PROMPT` — the first message handed to `claude` (built by
     `buildOpeningPrompt`, non-interactive closing — see `lib/armSession.ts`).
   - `CODEPET_DEMO_DIR` — cwd the runner spawns `claude` in (`/home/user/codepet-demo`).
   - `CODEPET_LIVE_PATH` — path suffix for live-event POSTs (`/api/track/live`).
   - `CODEPET_FINALIZE_PATH` — path suffix for the finalize POST (`/api/build/cloud-finalize`).
   - `CODEPET_CLAUDE_CMD` — the exact `claude` invocation to spawn, e.g.
     `claude -p --output-format stream-json --permission-mode bypassPermissions`.
3. Sets a `trap ... EXIT` that runs `node cloud-run.mjs --finalize-only` as a
   belt-and-suspenders finalize if the runner itself didn't get to its own exit handler.
4. Runs `node /home/user/cloud-run.mjs`.

The sandbox never receives the company's `ANTHROPIC_API_KEY` in the script text — it's
set as a sandbox env var by `startCloudBuild` (`Sandbox.create(..., { envs: { ANTHROPIC_API_KEY, ... } })`),
so it never appears in `/tmp/build.log` or the launch script on disk.

## `cloud-run.mjs` — what the runner must do

The runner is the only piece of logic that has to ship inside the template image. It:

1. Reads its configuration entirely from the `CODEPET_*` env vars listed above (no argv).
2. `cd $CODEPET_DEMO_DIR` and spawns `$CODEPET_CLAUDE_CMD "$CODEPET_OPENING_PROMPT"`
   (split the command string on spaces, then pass the prompt as the final argv element —
   don't shell-interpolate the prompt itself), streaming its stdout.
3. Parses stdout as newline-delimited `stream-json` events (one JSON object per line, same
   format `claude --output-format stream-json` always emits). For each parsed line:
   - POST it to `${CODEPET_API_URL}${CODEPET_LIVE_PATH}` as
     `{ companyId: CODEPET_COMPANY_ID, token: CODEPET_INGEST_TOKEN, event }`, where `event`
     is shaped to match `sanitizeLiveEvent` in `lib/liveBuild.ts` — i.e. it must include
     `buildSessionId` (= `CODEPET_BUILD_SESSION_ID`), `sessionId` (Claude Code's own
     `session_id` from the stream), and a `kind` of `'start' | 'tool' | 'turn' | 'ask'`
     (map the stream's own event types the same way `eventKindFor` maps hook event names:
     init → `start`, a tool-use block → `tool` with `tool` = the tool name, an assistant
     turn finishing → `turn` with an optional `say` narration, anything indicating Claude
     is waiting on input → `ask`). Fire-and-forget (don't block the stream on the POST
     resolving); a failed POST should not kill the build.
   - Sum tokens from each line's `message.usage` object — same fields
     `tokenReportSuffix` in `lib/armSession.ts` already sums for the local path:
     `input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens`.
   - Once the running total exceeds `CODEPET_TOKEN_CAP`, kill the `claude` child process
     (`SIGTERM`, then `SIGKILL` after a short grace period if it doesn't exit) and stop
     reading further stdout.
4. On exit (normal completion, token-cap kill, or the `--finalize-only` trap path):
   walk `$CODEPET_DEMO_DIR` for web files (skip dotfiles/`node_modules`/anything
   binary-looking as needed), cap at **≤ 50 files** and **≤ 5 MB total** (matches
   `MAX_FILES` / `MAX_TOTAL_BYTES` in `lib/build/finalize.ts` — sending more just gets
   rejected), base64-encode each, and POST once to
   `${CODEPET_API_URL}${CODEPET_FINALIZE_PATH}` as:
   ```json
   {
     "companyId": "<CODEPET_COMPANY_ID>",
     "token": "<CODEPET_INGEST_TOKEN>",
     "buildSessionId": "<CODEPET_BUILD_SESSION_ID>",
     "status": "ok" | "capped" | "error",
     "tokens": <running total>,
     "files": [{ "path": "index.html", "base64": "..." }, ...]
   }
   ```
   Use relative POSIX paths with no `..`/leading `/` segments (see `safePath` in
   `lib/build/finalize.ts` — anything else is rejected server-side). Make this POST
   idempotent-safe (guard against double-finalize from both the runner's own exit
   handler and the launcher's `trap ... EXIT` firing).

## Required build/runtime env

- `E2B_API_KEY` — set wherever `startCloudBuild` runs (the Codepet server), not in the
  sandbox; authenticates the E2B API call that creates the sandbox.
- `FIREBASE_STORAGE_BUCKET` — needed by the Codepet server side (`/api/build/cloud-finalize`
  → `lib/build/cloudStore.ts`) to persist the files the runner POSTs; not consumed inside
  the sandbox itself.
- The company's own `ANTHROPIC_API_KEY` — passed per-build as a sandbox env var by
  `startCloudBuild` (never baked into the template or the launch script).
- A `CODEPET_API_URL` reachable **from E2B's network** — i.e. the Codepet deployment must
  be publicly reachable (or reachable from wherever E2B sandboxes egress to), since the
  runner POSTs back to it over the open internet, not a private link.

## Repo build runner (real GitHub repo)

The GitHub-backed cloud build reuses the exact same `codepet-build` template and the
same `cloud-run.mjs` entrypoint — there is no second image. What differs is the launch
script: for a **repo build**, `lib/build/repoBuildScript.ts` (the repo-build counterpart
of `cloudBuildScript`) exports a different set of `CODEPET_*` env vars, and the runner
branches on their presence to clone a real repo, open a branch, and push a PR instead of
just POSTing files back for sandbox storage.

### Repo-build env vars (set by `lib/build/repoBuildScript.ts`)

- `CODEPET_REPO` — `owner/name` of the connected GitHub repository.
- `CODEPET_BRANCH` — the branch the runner creates and pushes to, `codepet/<buildSessionId>`.
- `CODEPET_INSTALL_TOKEN` — a short-lived GitHub App installation token, scoped to
  `CODEPET_REPO`, used for both the clone/push and the PR-creation API call. Never baked
  into the image or the launch script on disk beyond this one env var.
- `CODEPET_FINALIZE_PATH=/api/build/repo-finalize` — repo-build finalize endpoint (distinct
  from the demo build's `/api/build/cloud-finalize`).
- `CODEPET_LIVE_PATH=/api/track/live` — same live-event ingest endpoint as the demo build.
- `CODEPET_TOKEN_CAP` — max total tokens before the runner kills `claude`, `3_000_000` for
  repo builds (higher than the demo build's cap since repo builds tend to touch more code).
- `CODEPET_OPENING_PROMPT` — first message handed to `claude`, same convention as the demo
  build.
- `CODEPET_API_URL`, `CODEPET_COMPANY_ID`, `CODEPET_INGEST_TOKEN`, `CODEPET_BUILD_SESSION_ID`,
  `CODEPET_CLAUDE_CMD` — same meaning as the demo build (see above).

### Runner steps for a repo build

When `CODEPET_REPO` is present, `cloud-run.mjs` follows this sequence instead of the
demo-build's seed-dir + finalize-with-files flow:

1. **Clone**: `git clone https://x-access-token:$CODEPET_INSTALL_TOKEN@github.com/$CODEPET_REPO.git`
   — the installation token is embedded in the URL only for this one command; it isn't
   passed as argv elsewhere and isn't logged.
2. **Branch**: `git checkout -b $CODEPET_BRANCH` inside the clone.
3. **Run Claude**: spawn `$CODEPET_CLAUDE_CMD "$CODEPET_OPENING_PROMPT"` in the repo root,
   streaming stdout exactly as the demo build does — parse newline-delimited `stream-json`
   events, self-report each one to `${CODEPET_API_URL}${CODEPET_LIVE_PATH}` as
   `{ companyId: CODEPET_COMPANY_ID, token: CODEPET_INGEST_TOKEN, event }` (fire-and-forget),
   and sum `message.usage` tokens the same way. Once the running total exceeds
   `CODEPET_TOKEN_CAP`, kill the `claude` child (`SIGTERM` then `SIGKILL`) and stop reading.
4. **Commit**: `git add -A && git commit` with a runner-authored commit message.
5. **Push**: `git push origin $CODEPET_BRANCH` (still over the `x-access-token` remote URL
   from step 1, or an equivalent `Authorization: token` credential helper).
6. **Open a PR**: `POST /repos/$CODEPET_REPO/pulls` against the GitHub API, with
   `base` = the repository's default branch (read from the repo metadata, not hardcoded
   `main`/`master`), `head` = `$CODEPET_BRANCH`, and header
   `Authorization: token $CODEPET_INSTALL_TOKEN`.
7. **Finalize**: POST once to `${CODEPET_API_URL}${CODEPET_FINALIZE_PATH}` as:
   ```json
   {
     "companyId": "<CODEPET_COMPANY_ID>",
     "token": "<CODEPET_INGEST_TOKEN>",
     "buildSessionId": "<CODEPET_BUILD_SESSION_ID>",
     "status": "ok" | "capped" | "error",
     "tokens": <running total>,
     "prUrl": "<PR html_url from step 6>",
     "branch": "<CODEPET_BRANCH>",
     "pushed": true | false
   }
   ```
   As with the demo build, guard this against double-finalize (own exit handler vs. the
   launcher's `trap ... EXIT`). If the commit/push/PR steps fail partway (e.g. nothing to
   commit, push rejected, PR API error), still finalize with `pushed: false` and an
   appropriate `status`/omitted `prUrl` rather than hanging — the server-side finalize
   route is what decides whether to charge credit, and it only credits on a real, pushed PR.

### Registering the Codepet Builder GitHub App

The GitHub App itself is a one-time, out-of-repo setup (done once per environment) via
github.com → Settings → Developer settings → GitHub Apps → New GitHub App:

- **Permissions**: Repository permissions → **Contents: Read & write**,
  **Pull requests: Read & write**, **Metadata: Read-only**. No other repository or
  account permissions are needed.
- **Callback URL**: `<app>/api/github/callback` (where `<app>` is the Codepet deployment's
  base URL) — used for the connect flow's OAuth-style redirect back into the app.
- **Webhook**: not required for the build flow as specified; can be left inactive.
- After creation, generate a private key and note the App ID, Client ID, Client secret,
  and the App's slug (from its public `github.com/apps/<slug>` page).

Required env once registered — see the GitHub App section in `.env.example`:
`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`,
`GITHUB_APP_SLUG`, `GITHUB_STATE_SECRET`, and the client flag `NEXT_PUBLIC_CLOUD_REPO_BUILD`
to turn the repo-build UI path on.
