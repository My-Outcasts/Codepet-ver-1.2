import fs from 'node:fs';
import path from 'node:path';
import { mergeHook } from './settings.mjs';

/** Repo source of the SessionEnd tracker script. */
export function trackerSource(cwd = process.cwd()) {
  return path.join(cwd, 'toolkit', 'hooks', 'codepet-track.mjs');
}

/** Repo source of the live-activity hook script (SessionStart/PostToolUse/Stop). */
export function liveSource(cwd = process.cwd()) {
  return path.join(cwd, 'toolkit', 'hooks', 'codepet-live.mjs');
}

/** Repo source of the narration module installed beside the live hook. */
export function narrateSource(cwd = process.cwd()) {
  return path.join(cwd, 'toolkit', 'hooks', 'narrate.mjs');
}

/** During-session hook events the live emitter registers under. */
export const LIVE_HOOK_EVENTS = ['SessionStart', 'PostToolUse', 'Stop', 'Notification'];

/** Path to the tracker config inside a Claude config dir. */
function configPath(claudeDir) {
  return path.join(claudeDir, 'codepet', 'track.json');
}

/**
 * Read the tracker config from a Claude config dir.
 * @param {string} claudeDir
 * @returns {{ companyId: string, token: string, apiUrl: string, enabled?: boolean } | null}
 *   the parsed config, or null if it's missing or corrupt.
 */
export function readTrackingConfig(claudeDir) {
  try {
    return JSON.parse(fs.readFileSync(configPath(claudeDir), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Flip the tracker's `enabled` flag, preserving every other config field. The
 * SessionEnd hook skips its POST when `enabled === false` (see codepet-track.mjs).
 * @param {string} claudeDir
 * @param {boolean} enabled
 * @returns {{ companyId: string, token: string, apiUrl: string, enabled: boolean }}
 * @throws if no config is installed (nothing to toggle).
 */
export function setTrackingEnabled(claudeDir, enabled) {
  const cfg = readTrackingConfig(claudeDir);
  if (!cfg) throw new Error('tracker not installed — no track.json to toggle');
  const next = { ...cfg, enabled };
  fs.writeFileSync(configPath(claudeDir), JSON.stringify(next, null, 2));
  return next;
}

/**
 * Install the Claude Code activity tracker into a Claude config dir:
 *   1. copy the tracker script to <claudeDir>/codepet/codepet-track.mjs
 *   2. write <claudeDir>/codepet/track.json with the company's ingest config
 *   3. merge a SessionEnd command hook into <claudeDir>/settings.json (idempotent)
 *
 * @param {string} claudeDir
 * @param {{ companyId: string, token: string, apiUrl: string }} cfg
 * @param {string} [cwd] — repo root (for locating the script source)
 * @returns {{ script: string, config: string, settings: string, live: string, narrate: string }} written paths
 */
export function installTracking(claudeDir, cfg, cwd = process.cwd()) {
  if (!cfg?.companyId || !cfg?.token || !cfg?.apiUrl) {
    throw new Error('installTracking requires companyId, token, and apiUrl');
  }
  const codepetDir = path.join(claudeDir, 'codepet');
  fs.mkdirSync(codepetDir, { recursive: true });

  const scriptTarget = path.join(codepetDir, 'codepet-track.mjs');
  fs.writeFileSync(scriptTarget, fs.readFileSync(trackerSource(cwd), 'utf8'));

  // Default tracking on, but never clobber a flag the user already set from Settings.
  const prev = readTrackingConfig(claudeDir);
  const enabled = prev?.enabled ?? true;
  const configTarget = path.join(codepetDir, 'track.json');
  fs.writeFileSync(
    configTarget,
    JSON.stringify(
      { companyId: cfg.companyId, token: cfg.token, apiUrl: cfg.apiUrl, enabled },
      null,
      2,
    ),
  );

  const settingsTarget = path.join(claudeDir, 'settings.json');
  let settings = {};
  if (fs.existsSync(settingsTarget)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsTarget, 'utf8'));
    } catch {
      settings = {}; // corrupt settings — start clean rather than throw
    }
  }
  let merged = mergeHook(settings, 'SessionEnd', {
    type: 'command',
    command: `node ${scriptTarget}`,
  });

  // Live-activity emitter: copy the script and register the during-session hooks.
  const liveTarget = path.join(codepetDir, 'codepet-live.mjs');
  fs.writeFileSync(liveTarget, fs.readFileSync(liveSource(cwd), 'utf8'));
  const narrateTarget = path.join(codepetDir, 'narrate.mjs');
  fs.writeFileSync(narrateTarget, fs.readFileSync(narrateSource(cwd), 'utf8'));
  const liveEntry = { type: 'command', command: `node ${liveTarget}` };
  for (const evt of LIVE_HOOK_EVENTS) {
    merged = mergeHook(merged, evt, liveEntry);
  }

  fs.writeFileSync(settingsTarget, JSON.stringify(merged, null, 2));

  return { script: scriptTarget, config: configTarget, settings: settingsTarget, live: liveTarget, narrate: narrateTarget };
}
