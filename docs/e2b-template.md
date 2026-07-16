# E2B build template: `codepet-build`

This is the sandbox image `lib/build/cloudSandbox.ts` (`startCloudBuild`) boots via
`Sandbox.create('codepet-build', …)`. It is **not built by app code** — build it once
(and whenever the runner changes) with the E2B CLI and push it under this name/alias so
`Sandbox.create` can resolve it by template name.

## Base image

- Any Linux base with **Node ≥ 20** (the runner uses top-level `for await`, `AbortController`,
  etc. — nothing exotic, just modern Node).
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
