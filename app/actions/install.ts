'use server';
import { detectCapability, buildInstallCommand } from '@/lib/installer/capability.mjs';
import { resolveClaudeDir } from '@/lib/installer/paths.mjs';
import { installItems, uninstallItems, installedStatus } from '@/lib/installer/install.mjs';
import {
  installTracking,
  readTrackingConfig,
  setTrackingEnabled,
} from '@/lib/installer/tracking.mjs';
import { TOOLKIT, ALL_IDS, validateIds } from '@/lib/installer/manifest.mjs';

/** Config the local machine needs to auto-report Claude Code activity to /api/track. */
interface TrackingConfig {
  companyId: string;
  token: string;
  apiUrl: string;
}

function validTracking(t: TrackingConfig | undefined): t is TrackingConfig {
  return Boolean(t && t.companyId && t.token && t.apiUrl);
}

export async function getCapability() {
  return detectCapability(process.env);
}

export async function getToolkit() {
  return TOOLKIT;
}

export async function getStatus() {
  return installedStatus(ALL_IDS, resolveClaudeDir());
}

export async function installToolkit(ids: string[], tracking?: TrackingConfig) {
  if (detectCapability(process.env).mode === 'remote') {
    return { ok: false as const, reason: 'remote' as const };
  }
  const claudeDir = resolveClaudeDir();
  const results = installItems(validateIds(ids), claudeDir);
  // Best-effort: a tracker failure must not fail the toolkit install.
  let tracker: { status: 'installed' | 'error'; error?: string } | undefined;
  if (validTracking(tracking)) {
    try {
      installTracking(claudeDir, tracking);
      tracker = { status: 'installed' };
    } catch (e) {
      tracker = { status: 'error', error: e instanceof Error ? e.message : String(e) };
    }
  }
  return { ok: true as const, results, tracker };
}

export async function uninstallToolkit(ids: string[]) {
  if (detectCapability(process.env).mode === 'remote') {
    return { ok: false as const, reason: 'remote' as const };
  }
  return { ok: true as const, results: uninstallItems(validateIds(ids), resolveClaudeDir()) };
}

export async function getInstallCommand(ids: string[], tracking?: TrackingConfig) {
  return buildInstallCommand(validateIds(ids), validTracking(tracking) ? tracking : undefined);
}

/** Current tracker state on this machine. `enabled` defaults to true (absent flag
 *  = tracking on), matching the SessionEnd hook's fail-safe behavior. */
export async function getTrackingState() {
  if (detectCapability(process.env).mode === 'remote') {
    return { installed: false, enabled: false };
  }
  const cfg = readTrackingConfig(resolveClaudeDir());
  return { installed: Boolean(cfg), enabled: cfg ? cfg.enabled !== false : false };
}

/** Toggle whether the SessionEnd hook reports this machine's sessions. Local mode only. */
export async function setTracking(enabled: boolean) {
  if (detectCapability(process.env).mode === 'remote') {
    return { ok: false as const, reason: 'remote' as const };
  }
  try {
    const cfg = setTrackingEnabled(resolveClaudeDir(), enabled);
    return { ok: true as const, installed: true, enabled: cfg.enabled !== false };
  } catch {
    return { ok: false as const, reason: 'not-installed' as const };
  }
}

/** Whether the `claude` CLI itself is on this machine — the live "Let's build"
 *  session spawns it, so a missing binary must be caught with guidance, not a
 *  raw spawn failure. Local mode only; remote answers not-installed. */
export async function detectClaudeCli(): Promise<{ installed: boolean; version?: string }> {
  if (detectCapability(process.env).mode !== 'local') return { installed: false };
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { stdout } = await promisify(execFile)('claude', ['--version'], { timeout: 10_000 });
    return { installed: true, version: stdout.trim().slice(0, 60) };
  } catch {
    return { installed: false };
  }
}
