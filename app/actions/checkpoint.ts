'use server';
// "Save point" for a live build. createCheckpoint captures the project's full
// pre-build state as a dangling snapshot commit WITHOUT touching the working tree or
// index (it stages into a throwaway temp index). rewindToCheckpoint restores that
// snapshot. Local mode only (git runs on the user's machine). The choreography is
// validated against a scratch repo; the destructive step is guarded by an object-id
// check. See docs/superpowers/specs/2026-07-06-build-coach-in-chat-design.md.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectCapability } from '@/lib/installer/capability.mjs';
import { isObjectId, rewindPlan, SAVEPOINT_MESSAGE } from '@/lib/liveSession/gitCheckpoint';

const run = promisify(execFile);
const MAX = 1 << 24;
// A git identity for the snapshot commit, so commit-tree never fails on a repo/user
// with no configured user.name/email.
const IDENTITY = {
  GIT_AUTHOR_NAME: 'Codepet',
  GIT_AUTHOR_EMAIL: 'byte@codepet.local',
  GIT_COMMITTER_NAME: 'Codepet',
  GIT_COMMITTER_EMAIL: 'byte@codepet.local',
};

function git(dir: string, args: string[], env?: NodeJS.ProcessEnv) {
  return run('git', ['-C', dir, ...args], { env: env ?? process.env, maxBuffer: MAX });
}

/** Capture the project's full pre-build state as a snapshot commit, without touching
 *  the working tree or index. Returns the snapshot object id, or null when the dir
 *  isn't a git repo / git is unavailable (the feature then silently stays off). */
export async function createCheckpoint(projectDir: string): Promise<{ ref: string } | null> {
  if (!projectDir || detectCapability(process.env).mode !== 'local') return null;
  try {
    await git(projectDir, ['rev-parse', '--is-inside-work-tree']);
    let head = '';
    try {
      head = (await git(projectDir, ['rev-parse', 'HEAD'])).stdout.trim();
    } catch {
      /* no commits yet — snapshot will be parentless */
    }
    const idx = path.join(
      os.tmpdir(),
      `codepet-idx-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const env = { ...process.env, ...IDENTITY, GIT_INDEX_FILE: idx };
    try {
      await git(projectDir, ['add', '-A'], env);
      const tree = (await git(projectDir, ['write-tree'], env)).stdout.trim();
      const parent = head ? ['-p', head] : [];
      const snap = (
        await git(projectDir, ['commit-tree', tree, ...parent, '-m', SAVEPOINT_MESSAGE], env)
      ).stdout.trim();
      return isObjectId(snap) ? { ref: snap } : null;
    } finally {
      try {
        fs.rmSync(idx, { force: true });
      } catch {
        /* best-effort temp cleanup */
      }
    }
  } catch {
    return null;
  }
}

/** Restore the project to a snapshot from createCheckpoint (destructive by design:
 *  undoes everything the build changed). Guarded on a hex object id. */
export async function rewindToCheckpoint(
  projectDir: string,
  ref: string,
): Promise<{ ok: boolean; error?: string }> {
  if (detectCapability(process.env).mode !== 'local') return { ok: false, error: 'remote' };
  if (!projectDir || !isObjectId(ref)) return { ok: false, error: 'bad_request' };
  try {
    for (const args of rewindPlan(ref)) await git(projectDir, args);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'rewind_failed' };
  }
}
