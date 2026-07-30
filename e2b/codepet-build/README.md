# `codepet-build` — the E2B sandbox template for cloud builds

This directory is the source for the E2B template `codepet-build` that every Codepet cloud
build boots (`lib/build/cloudSandbox.ts` → `Sandbox.create('codepet-build', …)`). It is **not
built by app code** — build it once (and whenever `cloud-run.mjs` changes) with the E2B CLI.

## Contents

| File                | Role                                                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cloud-run.mjs`     | The runner that actually runs inside the sandbox: streams `claude`, self-reports live events, caps tokens, and finalizes (demo files → `/api/build/cloud-finalize`, or commit+push+PR → `/api/build/repo-finalize`). The single source of runner logic. |
| `cloud-run.test.ts` | Vitest unit tests for the runner's pure helpers (token sum, stream→event mapping, file filter, finalize-status). Run by the normal `npm test`.                                                                                                          |
| `Dockerfile`        | `node:20-slim` + `git` + the Claude Code CLI + `cloud-run.mjs`.                                                                                                                                                                                         |
| `e2b.toml`          | Template config (name `codepet-build`).                                                                                                                                                                                                                 |

See `docs/e2b-template.md` for the full runtime contract (env vars, event shapes, finalize
payloads) that `cloud-run.mjs` implements.

## Build & push the template

```sh
npm i -g @e2b/cli        # once
e2b auth login           # once — logs into your E2B account
cd e2b/codepet-build
e2b template build       # builds the Docker image and pushes it as `codepet-build`
```

Rebuild whenever `cloud-run.mjs` or the `Dockerfile` changes. `E2B_API_KEY` (used by the
Codepet server to boot the sandbox) is set in the app's environment, not here.

## Why the runner lives here (not in the image only)

Keeping `cloud-run.mjs` in the repo makes it version-controlled and unit-testable
(`cloud-run.test.ts`), instead of a loose file that only exists inside a built image. The
`e2b/` directory is excluded from the app's `tsconfig`/Next build — nothing in `app/` imports
it — so it ships only into the sandbox image via the `Dockerfile` `COPY`.
