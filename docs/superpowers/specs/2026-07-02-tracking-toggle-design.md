# Dev-only tracking toggle (Settings screen)

**Date:** 2026-07-02
**Status:** Approved, implementing
**Builds on:** [2026-07-01-claude-code-tracking-design.md](./2026-07-01-claude-code-tracking-design.md)

## Goal

Give the developer a Settings screen — **visible only in development** — with a
switch to enable/disable Claude Code session tracking on this machine. When off,
the `SessionEnd` hook stays installed but skips its POST, so the developer's own
dev sessions don't pollute the real Summary numbers.

## Why a flag (not uninstall)

The hook already reads `~/.claude/codepet/track.json` and does nothing if it's
missing/invalid. Adding an `enabled` flag the hook checks is the least invasive,
fully reversible mechanism: no reinstall, no settings.json churn, and it fails
safe (only an explicit `false` disables). The web app can write the file because
in development `detectCapability()` returns `local` mode (no `VERCEL` /
`CODEPET_REMOTE`), so server-action fs writes hit the developer's machine.

## Changes

### 1. Config — `track.json` gains `enabled`

Shape becomes `{ companyId, token, apiUrl, enabled }`. `installTracking` writes
`enabled: true` by default and preserves an existing `enabled` on reinstall.
`undefined`/absent is treated as enabled (backward-compatible with configs
written before this change).

### 2. Hook honors the flag — `toolkit/hooks/codepet-track.mjs`

After loading `cfg`, add one guard before building/POSTing the event:

```js
if (cfg.enabled === false) return; // tracking paused from Settings
```

Everything else unchanged. Only an explicit `false` disables (fail-safe).

### 3. Pure helpers — `lib/installer/tracking.mjs` (unit-tested)

- `readTrackingConfig(claudeDir)` → parsed `track.json`, or `null` if
  missing/corrupt.
- `setTrackingEnabled(claudeDir, enabled)` → reads the config, sets `enabled`,
  rewrites the file preserving all other fields; throws if no config exists
  (nothing installed to toggle). Idempotent, never mutates input.

### 4. Server actions — `app/actions/install.ts`

- `getTrackingState()` → `{ installed: boolean, enabled: boolean }`. Reads the
  config via `readTrackingConfig(resolveClaudeDir())`. In remote mode returns
  `{ installed: false, enabled: false }` (screen is dev-only anyway).
- `setTracking(enabled: boolean)` → local-mode guard (returns
  `{ ok: false, reason: 'remote' }` if remote), else calls `setTrackingEnabled`
  and returns the new `{ ok: true, installed, enabled }`.

### 5. UI — `SettingsView` + Sidebar entry, both dev-gated

- Add `'settings'` to the `View` union in `lib/store.tsx`.
- `components/views/SettingsView.tsx`: on mount calls `getTrackingState()`;
  renders a labeled switch bound to `enabled`. Flipping it calls `setTracking()`
  optimistically and reverts on error. When `installed` is false, the switch is
  disabled with an "Install the tracker first" hint pointing at First install.
- `components/Sidebar.tsx`: a "Settings" nav item under **Your setup**, rendered
  only when `process.env.NODE_ENV === 'development'` (Next inlines this literal in
  the client bundle, so it compiles out of production). `AppRoot` routes the
  `settings` view under the same guard.

### Switch styling

Reuse existing button/toggle styling patterns from `globals.css` (the
Environment view's `eb`/`on` states). Add a small `.switch` component style only
if no existing pattern fits.

## Testing

- `lib/installer/tracking.test.mjs`: `readTrackingConfig` (missing / corrupt /
  valid) and `setTrackingEnabled` (sets flag, preserves other fields, throws when
  absent, round-trips true↔false). Extend `installTracking` coverage for the
  default `enabled: true` and preservation on reinstall.
- Hook `cfg.enabled === false` branch is a one-line guard — noted as needing
  real-machine e2e like the rest of the hook (see the base spec's honesty
  section).
- `yarn typecheck` + eslint + prettier clean.

## Out of scope (YAGNI)

- No production/hosted toggle — dev-only by request.
- No per-repo or per-session granularity.
- No remote-mode copy-paste variant of the toggle.
