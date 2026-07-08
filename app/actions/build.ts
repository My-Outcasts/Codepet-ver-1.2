'use server';
// Arm a live build session on the local machine: write the arm-file the live hook
// reads (~/.claude/codepet/current-build.json) and open a Terminal running `claude`
// with the plan preloaded. Local mode only (fs + spawn hit the user's machine);
// in remote mode we return the command for the UI to show as copy-paste.
// See docs/superpowers/specs/2026-07-02-build-coach-live-session-design.md.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { detectCapability } from '@/lib/installer/capability.mjs';
import { resolveClaudeDir } from '@/lib/installer/paths.mjs';
import { buildOpeningPrompt, terminalCommand, terminalLaunchCandidates } from '@/lib/armSession';
import type { BytePlan } from '@/lib/ai/plan';

interface ArmInput {
  buildSessionId: string;
  projectDir: string;
  plan: BytePlan;
  brief: string;
  companyId: string;
  token: string;
  apiUrl: string;
}

function writeArmFile(claudeDir: string, input: ArmInput) {
  const dir = path.join(claudeDir, 'codepet');
  fs.mkdirSync(dir, { recursive: true });
  const { buildSessionId, projectDir, plan, brief, companyId, token, apiUrl } = input;
  fs.writeFileSync(
    path.join(dir, 'current-build.json'),
    JSON.stringify(
      {
        buildSessionId,
        projectDir,
        plan,
        brief,
        companyId,
        token,
        apiUrl,
        startedAt: Date.now(),
      },
      null,
      2,
    ),
  );
}

/** Write the arm-file and (macOS local mode) open a Terminal running `claude`.
 *  Returns `{ launched }` locally; in remote mode returns the copy-paste command. */
export async function armBuildSession(
  input: ArmInput,
): Promise<{ ok: true; launched: boolean } | { ok: false; reason: 'remote'; command: string }> {
  const prompt = buildOpeningPrompt(input.plan, input.brief);
  const command = terminalCommand(input.projectDir, prompt);

  if (detectCapability(process.env).mode === 'remote') {
    return { ok: false, reason: 'remote', command };
  }

  writeArmFile(resolveClaudeDir(), input);

  // Best-effort terminal open per platform; any failure just falls back to the
  // copy-paste card the caller already shows.
  if (process.platform === 'darwin') {
    const script = `tell application "Terminal" to do script ${JSON.stringify(command)}\ntell application "Terminal" to activate`;
    try {
      spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true, launched: true };
    } catch {
      return { ok: true, launched: false };
    }
  }
  for (const c of terminalLaunchCandidates(process.platform, command)) {
    if (!binaryAvailable(c.cmd)) continue;
    try {
      spawn(c.cmd, c.args, { detached: true, stdio: 'ignore' }).unref();
      return { ok: true, launched: true };
    } catch {
      // try the next emulator
    }
  }
  return { ok: true, launched: false };
}

/** Whether a chosen project directory IS the running Codepet app itself.
 *  Building the app that hosts the build is the snake eating its own tail: an
 *  edit triggers a dev hot-reload which used to kill the live session — the UI
 *  warns before the founder starts such a build. */
export async function isAppDir(projectDir: string): Promise<boolean> {
  if (!projectDir) return false;
  try {
    return path.resolve(projectDir) === path.resolve(process.cwd());
  } catch {
    return false;
  }
}

/** Scan one project directory on demand (local mode) — the compact brief Byte's
 *  intake brainstorm + plan prompt read. Hosted mode returns null (the founder's
 *  disk is unreachable from the cloud); the caller falls back to the stored brief
 *  the scan CLI uploaded, or to a generic intake. */
export async function scanProject(
  projectDir: string,
): Promise<{ frameworks: string[]; deps: string[]; dirs: string[]; readme: string } | null> {
  if (!projectDir || detectCapability(process.env).mode !== 'local') return null;
  try {
    const { summarizeProject } = await import('@/lib/installer/projectBrief.mjs');
    return summarizeProject(projectDir);
  } catch {
    return null;
  }
}

/** Whether a launcher binary exists on PATH (`where` on Windows, `which` elsewhere). */
function binaryAvailable(cmd: string): boolean {
  try {
    const probe = process.platform === 'win32' ? 'where' : 'which';
    return spawnSync(probe, [cmd], { stdio: 'ignore', timeout: 3000 }).status === 0;
  } catch {
    return false;
  }
}
