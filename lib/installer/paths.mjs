import os from 'node:os';
import path from 'node:path';

/** Resolve the Claude config dir. Honors CODEPET_CLAUDE_DIR (tests/CLI/verification). */
export function resolveClaudeDir(env = process.env) {
  if (env.CODEPET_CLAUDE_DIR) return env.CODEPET_CLAUDE_DIR;
  return path.join(os.homedir(), '.claude');
}

/** Destination path for an item, derived — never from the client. */
export function targetPath(item, claudeDir) {
  if (item.type === 'skill') return path.join(claudeDir, 'skills', item.id, 'SKILL.md');
  if (item.type === 'agent') return path.join(claudeDir, 'agents', `${item.id}.md`);
  throw new Error(`Unknown item type: ${item.type}`);
}

/** The managed target to remove on uninstall (dir for skills, file for agents). */
export function managedTarget(item, claudeDir) {
  if (item.type === 'skill') return { kind: 'dir', path: path.join(claudeDir, 'skills', item.id) };
  if (item.type === 'agent')
    return { kind: 'file', path: path.join(claudeDir, 'agents', `${item.id}.md`) };
  throw new Error(`Unknown item type: ${item.type}`);
}

/** Source path in the repo toolkit dir. */
export function sourcePath(item, cwd = process.cwd()) {
  return path.join(cwd, 'toolkit', item.source);
}
