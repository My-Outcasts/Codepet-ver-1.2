# Real Install (v2) — design spec

**Date:** 2026-06-30
**Status:** Approved, ready for implementation plan
**Builds on:** the demo "First install" view (`docs/superpowers/specs/2026-06-30-first-install-design.md`)

## Goal

Turn the demo "First install" into a **real** installer: when the user presses "Wake byte up"
while Codepet runs locally, a Next.js server action copies real Claude Code skill/agent files into
`~/.claude`, and reports the actual per-item result. When Codepet runs in a remote/hosted
environment (where the server cannot reach the user's machine), the button falls back to showing a
copy-paste terminal command.

## Why this shape

A browser cannot touch the user's filesystem. Only server-side code can — and only when the Next.js
server *is* the user's machine (localhost). So real one-click install requires local-run mode;
hosted mode degrades to a pasteable command. This is a hard browser-sandbox constraint, not a choice.

## Scope

### In scope (v1)
- Bundle a small but real toolkit in the repo: skill + agent markdown definitions.
- A shared, Next-free installer core that copies toolkit items into `~/.claude/skills/<slug>/SKILL.md`
  and `~/.claude/agents/<slug>.md`, idempotently, returning a structured per-item report.
- Server actions wrapping the core: capability detection, status, install, uninstall, command.
- A CLI wrapper over the same core for the fallback/paste path.
- Rewire `InstallView.tsx` to call the real server actions (drop the mock `ENV` flipping).
- Real "installed" state read from disk (not just localStorage); an Uninstall affordance.
- Remote fallback: show a copy-paste command instead of the one-click button.
- `node:test` unit tests for the installer core (operating on a temp claude-dir).

### Out of scope (v1)
- Writing `~/.claude/settings.json` (hooks/statusline) — shown as optional "later" chips only.
- MCP/connector OAuth (GitHub/Notion stay "connect later", no auto-install).
- Publishing an npm package or a Claude Code marketplace.
- Syncing the existing mock Environment view with real on-disk state (it stays demo).

## The bundled toolkit

Real, minimal, valid definitions under `toolkit/`:

- `toolkit/skills/prd-writer/SKILL.md` — "PRD writer" (valid frontmatter: `name`, `description`).
- `toolkit/skills/code-review/SKILL.md` — "Code review".
- `toolkit/agents/test-writer.md` — "Test Writer" agent.
- `toolkit/manifest.mjs` — the allowlist describing each item.

`manifest.mjs` exports `TOOLKIT`: an array of
`{ id, name, type: 'skill'|'agent', source, desc }` where `source` is the repo-relative path under
`toolkit/`. Targets are derived, never taken from the client:
- skill → `<claudeDir>/skills/<id>/SKILL.md`
- agent → `<claudeDir>/agents/<id>.md`

(`id` is a kebab-case slug validated by `^[a-z0-9-]+$`.)

## Architecture

### Installer core — `lib/installer/` (plain `.mjs`, no Next imports, JSDoc-typed)

Written as `.mjs` so it runs directly under `node:test` with zero new dependencies, and is imported
by both the server actions (`.ts`) and the CLI (`.mjs`).

- `lib/installer/manifest.mjs` — re-exports `TOOLKIT` from `toolkit/manifest.mjs`; helper
  `itemsByIds(ids)` returns the manifest entries for the given ids, throwing on any unknown id.
- `lib/installer/paths.mjs`
  - `resolveClaudeDir()` → `path.join(os.homedir(), '.claude')`.
  - `targetPath(item, claudeDir)` → derived destination (skills/agents rule above).
  - `sourcePath(item)` → `path.join(process.cwd(), 'toolkit', item.source)`.
- `lib/installer/install.mjs`
  - `installItems(ids, claudeDir)` → `InstallResult[]`. For each item: ensure target dir, read
    source, compare to existing target; write if absent/different. Returns
    `{ id, name, type, target, status: 'created'|'updated'|'skipped'|'error', error? }`.
    Only ever writes under `claudeDir/skills` and `claudeDir/agents`.
  - `uninstallItems(ids, claudeDir)` → `{ id, status: 'removed'|'absent'|'error', error? }[]`.
    Removes only the item's managed target (the `skills/<id>/` dir or `agents/<id>.md`).
  - `installedStatus(ids, claudeDir)` → `{ id, installed: boolean, target }[]` (existence check).
- `lib/installer/capability.mjs`
  - `detectCapability(env)` → `{ mode: 'local'|'remote', reason }`. `remote` when
    `env.CODEPET_REMOTE === '1'` or `env.VERCEL` is set or no home dir; else `local`. Pure function
    of an env object (so it is unit-testable).
  - `buildInstallCommand(ids)` → the fallback string:
    `node scripts/install-toolkit.mjs <id> <id> …` (run from a cloned Codepet repo).

### Server actions — `app/actions/install.ts` (`'use server'`)

Thin wrappers that inject server-only state and never accept paths/content from the client — only
ids, re-validated against the manifest:
- `getCapability()` → `detectCapability(process.env)`.
- `getStatus()` → `installedStatus(allIds, resolveClaudeDir())` (+ the toolkit listing for the UI).
- `installToolkit(ids)` → refuses with an error result if capability is `remote`; otherwise
  `installItems(validate(ids), resolveClaudeDir())`.
- `uninstallToolkit(ids)` → `uninstallItems(validate(ids), resolveClaudeDir())`.
- `getInstallCommand(ids)` → `buildInstallCommand(validate(ids))`.

`validate(ids)` intersects with manifest ids and throws on anything unknown — the security boundary.

### CLI — `scripts/install-toolkit.mjs`

`node scripts/install-toolkit.mjs <ids…>` → calls `installItems` and prints the report. Used by the
remote fallback command and runnable standalone. Shares the exact core the server action uses.

### UI — `components/views/InstallView.tsx` (rewrite of the data layer, same visual language)

- On mount: `getCapability()` + `getStatus()`.
- `mode === 'local'`:
  - Fresh: "Wake byte up" button → `installToolkit(ids)` → render the **real** per-item report
    (created/updated/skipped/error + target path), keeping the existing warm styling and the
    `.done` row state (the bug-fixed class).
  - Recap (already installed, from disk status): list installed items + an **Uninstall** button
    (`uninstallToolkit`).
- `mode === 'remote'`: hide the one-click button; show a "copy this command" block from
  `getInstallCommand(ids)` with a copy button and one line of instruction.
- Connectors (GitHub/Notion) and the statusline/hook chips remain decorative "later" items.
- localStorage `codepet:installed` is dropped as the source of truth; disk status replaces it.

## Data flow

1. View mounts → server actions report capability + on-disk status.
2. Local + press install → server action copies files into `~/.claude` → returns real results → UI
   shows them; a re-fetch of status confirms.
3. Remote → UI shows the exact command; the user runs it; the CLI performs the same install.
4. Uninstall → server action removes the managed targets → status refetched.

## Error handling & safety

- The client sends only ids; `validate()` rejects anything not in the manifest → no arbitrary paths.
- Writes are confined to `claudeDir/skills/<id>/` and `claudeDir/agents/<id>.md`; uninstall removes
  only those managed targets; nothing else is touched or deleted.
- `installItems` is idempotent: existing-and-identical → `skipped`; existing-and-different →
  `updated`; missing → `created`; per-item failures are captured as `error` without aborting the rest.
- Remote mode refuses to write and steers to the command fallback.
- Missing source file or unreadable target surfaces as a per-item `error`, never a crash.

## Testing

- `node:test` suites for the installer core, run against a temp directory used as `claudeDir`:
  - `install.test.mjs`: created → skipped on re-run → updated after source change → error on a bad
    id (via `itemsByIds`) → writes land at the expected target paths → uninstall removes them →
    `installedStatus` reflects before/after.
  - `capability.test.mjs`: `local` by default; `remote` for `CODEPET_REMOTE=1`, for `VERCEL`, and
    when no home dir; `buildInstallCommand` emits the expected string.
- Add `"test": "node --test"` (scoped to the installer) to `package.json` scripts — the repo gains a
  real test runner with zero new dependencies.
- UI/integration verified via `yarn build` plus a headless-browser pass (as used for v1), asserting
  the local flow renders the real report and the remote flow renders the command block.

## File structure summary

```
toolkit/manifest.mjs
toolkit/skills/prd-writer/SKILL.md
toolkit/skills/code-review/SKILL.md
toolkit/agents/test-writer.md
lib/installer/manifest.mjs
lib/installer/paths.mjs
lib/installer/install.mjs
lib/installer/capability.mjs
lib/installer/install.test.mjs
lib/installer/capability.test.mjs
app/actions/install.ts
scripts/install-toolkit.mjs
components/views/InstallView.tsx   (rewire data layer)
package.json                       (add "test" script)
```
