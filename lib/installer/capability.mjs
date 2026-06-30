import os from 'node:os';

/** Decide whether this server can install onto the user's machine. */
export function detectCapability(env = process.env, getHome = () => { try { return os.homedir(); } catch { return ''; } }) {
  if (env.CODEPET_REMOTE === '1') return { mode: 'remote', reason: 'CODEPET_REMOTE' };
  if (env.VERCEL) return { mode: 'remote', reason: 'VERCEL' };
  const home = env.CODEPET_CLAUDE_DIR || getHome();
  if (!home) return { mode: 'remote', reason: 'no-home' };
  return { mode: 'local', reason: 'local' };
}

/** Fallback command shown when remote — run from a cloned Codepet repo. */
export function buildInstallCommand(ids) {
  return `node scripts/install-toolkit.mjs ${ids.join(' ')}`;
}
