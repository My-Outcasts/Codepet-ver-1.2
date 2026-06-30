'use server';
import { detectCapability, buildInstallCommand } from '@/lib/installer/capability.mjs';
import { resolveClaudeDir } from '@/lib/installer/paths.mjs';
import { installItems, uninstallItems, installedStatus } from '@/lib/installer/install.mjs';
import { TOOLKIT, ALL_IDS, validateIds } from '@/lib/installer/manifest.mjs';

export async function getCapability() {
  return detectCapability(process.env);
}

export async function getToolkit() {
  return TOOLKIT;
}

export async function getStatus() {
  return installedStatus(ALL_IDS, resolveClaudeDir());
}

export async function installToolkit(ids: string[]) {
  if (detectCapability(process.env).mode === 'remote') {
    return { ok: false as const, reason: 'remote' as const };
  }
  return { ok: true as const, results: installItems(validateIds(ids), resolveClaudeDir()) };
}

export async function uninstallToolkit(ids: string[]) {
  return uninstallItems(validateIds(ids), resolveClaudeDir());
}

export async function getInstallCommand(ids: string[]) {
  return buildInstallCommand(validateIds(ids));
}
