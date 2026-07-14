'use server';
// Arm a live build session on the local machine: write the arm-file the live hook
// reads (~/.claude/codepet/current-build.json) and open a Terminal running `claude`
// with the plan preloaded. Local mode only (fs + spawn hit the user's machine);
// in remote mode we return the command for the UI to show as copy-paste.
// See docs/superpowers/specs/2026-07-02-build-coach-live-session-design.md.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { detectCapability } from '@/lib/installer/capability.mjs';
import { resolveClaudeDir } from '@/lib/installer/paths.mjs';
import { buildOpeningPrompt, terminalCommand, DEMO_SEED_HTML, DEMO_PORT } from '@/lib/armSession';
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

  // macOS-first Terminal open. Other platforms: no launch, caller shows the command.
  if (process.platform === 'darwin') {
    const script = `tell application "Terminal" to do script ${JSON.stringify(command)}\ntell application "Terminal" to activate`;
    try {
      spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true, launched: true };
    } catch {
      return { ok: true, launched: false };
    }
  }
  return { ok: true, launched: false };
}

/** Create + seed the throwaway demo project on the local machine (local mode only —
 *  in remote mode the copy-paste command seeds it instead). Returns the absolute dir.
 *  Seeds index.html only if missing, so re-runs keep byte's earlier work. */
export async function scaffoldDemoProject(): Promise<string> {
  const dir = path.join(os.homedir(), 'codepet-demo');
  fs.mkdirSync(dir, { recursive: true });
  const index = path.join(dir, 'index.html');
  if (!fs.existsSync(index)) fs.writeFileSync(index, DEMO_SEED_HTML);
  if (!fs.existsSync(path.join(dir, '.git'))) {
    try {
      spawnSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
    } catch {
      /* git missing — the demo still works, the recap just won't show commits */
    }
  }

  // Serve the demo on localhost so the app's "Open demo" link works in LOCAL mode too
  // (remote mode's copy-paste command serves it instead). Best-effort; a stale server already
  // bound to the port just fails harmlessly and keeps serving fresh reads off disk.
  try {
    const server = spawn('python3', ['-m', 'http.server', String(DEMO_PORT)], {
      cwd: dir,
      detached: true,
      stdio: 'ignore',
    });
    server.unref();
  } catch {
    /* python missing — the Open demo link just won't resolve in local mode */
  }

  return dir;
}
