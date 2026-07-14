'use server';
// Today's total Claude Code tokens for a LOCAL app, via ccusage. Best-effort: returns null
// on any error or when ccusage isn't available (e.g. hosted/remote). Never throws.
import { spawn } from 'node:child_process';

function ymd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

export async function getTodayTokens(): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const since = ymd(new Date());
      const child = spawn('npx', ['-y', 'ccusage@latest', 'daily', '--since', since, '--json'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let out = '';
      const timer = setTimeout(() => {
        child.kill();
        resolve(null);
      }, 20000);
      child.stdout.on('data', (b) => (out += b.toString()));
      child.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
      child.on('close', () => {
        clearTimeout(timer);
        try {
          const total = JSON.parse(out)?.totals?.totalTokens;
          resolve(typeof total === 'number' ? total : null);
        } catch {
          resolve(null);
        }
      });
    } catch {
      resolve(null);
    }
  });
}
