// Codepet cloud build runner — the ONLY logic that ships inside the E2B `codepet-build`
// template image. The launcher bash script (lib/build/cloudBuildScript.ts for a demo build,
// lib/build/repoBuildScript.ts for a real-repo build) seeds the work dir, exports the
// runner's config as CODEPET_* env vars, and runs `node /home/user/cloud-run.mjs`. See
// docs/e2b-template.md for the full contract this file implements.
//
// Two modes, chosen by the presence of CODEPET_REPO:
//   • demo build  — cwd is a seeded throwaway dir; on exit gather the built web files and
//                   POST them (+ tokens) to /api/build/cloud-finalize.
//   • repo build  — cwd is a freshly-cloned real repo on branch CODEPET_BRANCH (the launcher
//                   already cloned + checked out); on exit commit + push + open a PR, then
//                   POST the PR url (+ tokens) to /api/build/repo-finalize.
// Both stream `claude` stdout as newline-delimited stream-json, self-report each line to
// /api/track/live, sum message.usage tokens, and kill claude once the running total exceeds
// CODEPET_TOKEN_CAP.
//
// SECURITY: no secret is ever passed as argv (only env) so nothing leaks into `ps` for other
// tenants sharing sandbox infra; the GitHub installation token lives only in the clone/push
// remote URL and the PR API Authorization header, never logged.
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

// ----------------------------------------------------------------------------------------
// Pure helpers (exported for unit tests; no I/O, no side effects).
// ----------------------------------------------------------------------------------------

/** Sum a stream-json message's usage the same way the app's tokenReportSuffix does:
 *  input + output + cache-creation + cache-read. Missing/garbage → 0. */
export function usageTokens(usage) {
  if (!usage || typeof usage !== 'object') return 0;
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return (
    n(usage.input_tokens) +
    n(usage.output_tokens) +
    n(usage.cache_creation_input_tokens) +
    n(usage.cache_read_input_tokens)
  );
}

/** Map one parsed stream-json object to zero or more live events (kind + optional tool/say);
 *  the caller stamps sessionId/buildSessionId/ts. Mirrors eventKindFor's intent for the
 *  cloud stream: init → start, a tool_use block → tool, a text turn / final result → turn.
 *  A watch-only `-p` run never asks, so no `ask` kind is produced. */
export function liveEventsFor(obj) {
  if (!obj || typeof obj !== 'object') return [];
  if (obj.type === 'system' && obj.subtype === 'init') return [{ kind: 'start' }];
  if (obj.type === 'assistant') {
    const content = Array.isArray(obj.message && obj.message.content) ? obj.message.content : [];
    const tools = content
      .filter((b) => b && b.type === 'tool_use' && typeof b.name === 'string')
      .map((b) => ({ kind: 'tool', tool: b.name }));
    if (tools.length) return tools;
    const text = content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join(' ')
      .trim();
    return text ? [{ kind: 'turn', say: text.slice(0, 160) }] : [];
  }
  if (obj.type === 'result') {
    const say = typeof obj.result === 'string' ? obj.result.trim().slice(0, 160) : '';
    return say ? [{ kind: 'turn', say }] : [];
  }
  return [];
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage']);
const WEB_EXT = new Set([
  'html',
  'htm',
  'css',
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'tsx',
  'json',
  'md',
  'txt',
  'svg',
  'xml',
  'yml',
  'yaml',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
  'woff',
  'woff2',
]);

/** Whether a demo build's relative POSIX path should be sent to cloud-finalize: skip
 *  dotfiles/dotdirs and known heavy dirs, keep only web/text-ish extensions. The result is
 *  always safePath-compatible (relative, no '.'/'..' segments) since we skip dot segments. */
export function includeDemoFile(relPath) {
  if (typeof relPath !== 'string' || !relPath) return false;
  const segs = relPath.split('/');
  if (segs.some((s) => s === '' || s === '.' || s === '..' || s.startsWith('.'))) return false;
  if (segs.some((s) => SKIP_DIRS.has(s))) return false;
  const dot = relPath.lastIndexOf('.');
  const ext = dot >= 0 ? relPath.slice(dot + 1).toLowerCase() : '';
  return WEB_EXT.has(ext);
}

/** A repo build charges only when a real PR was pushed — mirror /api/build/repo-finalize,
 *  which credits solely on status==='ok' && pushed===true. */
export function repoFinalizeStatus({ pushed, prUrl }) {
  return pushed && typeof prUrl === 'string' && prUrl ? 'ok' : 'error';
}

/** Demo build status: only a clean completion charges; a token-cap kill or a non-zero
 *  claude exit is reported as non-'ok' so cloud-finalize doesn't charge. */
export function demoFinalizeStatus({ capped, exitCode }) {
  if (capped) return 'capped';
  return exitCode === 0 ? 'ok' : 'error';
}

// ----------------------------------------------------------------------------------------
// Runtime (only runs when invoked directly, not when imported by the test).
// ----------------------------------------------------------------------------------------

const MAX_FILES = 50;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;

function cfg() {
  const e = process.env;
  return {
    apiUrl: (e.CODEPET_API_URL || '').replace(/\/$/, ''),
    companyId: e.CODEPET_COMPANY_ID || '',
    ingestToken: e.CODEPET_INGEST_TOKEN || '',
    buildSessionId: e.CODEPET_BUILD_SESSION_ID || '',
    tokenCap: Number(e.CODEPET_TOKEN_CAP) || 0,
    openingPrompt: e.CODEPET_OPENING_PROMPT || '',
    claudeCmd: e.CODEPET_CLAUDE_CMD || 'claude -p --output-format stream-json',
    livePath: e.CODEPET_LIVE_PATH || '/api/track/live',
    finalizePath: e.CODEPET_FINALIZE_PATH || '',
    demoDir: e.CODEPET_DEMO_DIR || process.cwd(),
    repo: e.CODEPET_REPO || '',
    branch: e.CODEPET_BRANCH || '',
    installToken: e.CODEPET_INSTALL_TOKEN || '',
  };
}

function markerPath(buildSessionId) {
  return path.join(
    '/tmp',
    `codepet-finalized-${(buildSessionId || 'build').replace(/[^\w.-]/g, '_')}`,
  );
}

async function postLive(c, event) {
  // Fire-and-forget: a failed live POST must never disturb the build.
  try {
    await fetch(`${c.apiUrl}${c.livePath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ companyId: c.companyId, token: c.ingestToken, event }),
    });
  } catch {
    /* ignore */
  }
}

async function postFinalize(c, payload) {
  const res = await fetch(`${c.apiUrl}${c.finalizePath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      companyId: c.companyId,
      token: c.ingestToken,
      buildSessionId: c.buildSessionId,
      ...payload,
    }),
  });
  return res.ok;
}

/** Run `claude`, streaming stream-json: self-report live events, sum tokens, kill past the
 *  cap. Resolves { tokens, capped, exitCode, sessionId }. */
function runClaude(c) {
  return new Promise((resolve) => {
    const parts = c.claudeCmd.split(' ').filter(Boolean);
    const cmd = parts[0];
    const args = [...parts.slice(1), c.openingPrompt];
    const child = spawn(cmd, args, { cwd: process.cwd(), env: process.env });

    let tokens = 0;
    let capped = false;
    let killed = false;
    let sessionId = '';

    const kill = () => {
      if (killed) return;
      killed = true;
      capped = true;
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, 3000);
    };

    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        return; // non-JSON stdout (rare) — ignore
      }
      if (typeof obj.session_id === 'string' && obj.session_id) sessionId = obj.session_id;
      if (sessionId) {
        for (const ev of liveEventsFor(obj)) {
          void postLive(c, { ...ev, buildSessionId: c.buildSessionId, sessionId, ts: Date.now() });
        }
      }
      tokens += usageTokens(obj.message && obj.message.usage);
      if (c.tokenCap > 0 && tokens > c.tokenCap && !killed) kill();
    });

    child.on('close', (code) => resolve({ tokens, capped, exitCode: code ?? 0, sessionId }));
    child.on('error', () => resolve({ tokens, capped, exitCode: 1, sessionId }));
  });
}

/** Walk cwd for the demo build's web files, capped at 50 files / 5MB total. Logs (never
 *  silently drops) when a cap truncates the set. */
async function collectDemoFiles(root) {
  const out = [];
  let total = 0;
  let truncated = false;
  async function walk(dir) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= MAX_FILES || total >= MAX_TOTAL_BYTES) {
        truncated = true;
        return;
      }
      const full = path.join(dir, ent.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
        await walk(full);
      } else if (ent.isFile() && includeDemoFile(rel)) {
        let buf;
        try {
          buf = await fsp.readFile(full);
        } catch {
          continue;
        }
        if (total + buf.length > MAX_TOTAL_BYTES) {
          truncated = true;
          continue;
        }
        out.push({ path: rel, base64: buf.toString('base64') });
        total += buf.length;
      }
    }
  }
  await walk(root);
  if (truncated) {
    console.warn(`[cloud-run] demo file set truncated at ${out.length} files / ${total} bytes`);
  }
  return out;
}

function sh(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts });
    let stdout = '';
    let stderr = '';
    if (child.stdout) child.stdout.on('data', (d) => (stdout += d));
    if (child.stderr) child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
    child.on('error', () => resolve({ code: 1, stdout, stderr }));
  });
}

const GH_HEADERS = (token) => ({
  Authorization: `token ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'content-type': 'application/json',
});

/** Commit everything, push the branch, open a PR against the repo's default branch. Returns
 *  { pushed, prUrl }. Any failure (nothing to commit, push rejected, PR error) → pushed:false
 *  so finalize reports a non-charging build rather than hanging. */
async function commitPushPR(c) {
  await sh('git', ['config', 'user.email', 'builder@codepet.ai']);
  await sh('git', ['config', 'user.name', 'Codepet Builder']);
  await sh('git', ['add', '-A']);
  const commit = await sh('git', ['commit', '-m', `Codepet build ${c.buildSessionId}`]);
  if (commit.code !== 0) return { pushed: false, prUrl: undefined }; // nothing to commit
  const push = await sh('git', ['push', 'origin', c.branch]);
  if (push.code !== 0) return { pushed: false, prUrl: undefined };

  try {
    const metaRes = await fetch(`https://api.github.com/repos/${c.repo}`, {
      headers: GH_HEADERS(c.installToken),
    });
    if (!metaRes.ok) return { pushed: true, prUrl: undefined };
    const base = (await metaRes.json()).default_branch || 'main';
    const prRes = await fetch(`https://api.github.com/repos/${c.repo}/pulls`, {
      method: 'POST',
      headers: GH_HEADERS(c.installToken),
      body: JSON.stringify({
        title: `Codepet build ${c.buildSessionId}`,
        head: c.branch,
        base,
        body: 'Built by Codepet. Review the changes on this branch and merge when ready.',
      }),
    });
    if (!prRes.ok) return { pushed: true, prUrl: undefined };
    const prUrl = (await prRes.json()).html_url;
    return { pushed: true, prUrl: typeof prUrl === 'string' ? prUrl : undefined };
  } catch {
    return { pushed: true, prUrl: undefined };
  }
}

async function finalizeDemo(c, { tokens, status, files }) {
  // cloud-finalize rejects an empty file list, so always send at least the seeded index.html.
  const payload = { status, tokens, files };
  await postFinalize(c, payload);
}

async function main() {
  const c = cfg();
  const finalizeOnly = process.argv.includes('--finalize-only');
  const marker = markerPath(c.buildSessionId);
  const isRepo = !!c.repo;

  // Belt-and-suspenders trap path: if the main runner already finalized (marker present),
  // do nothing; otherwise send a conservative, non-charging finalize so the build ends.
  if (finalizeOnly) {
    if (fs.existsSync(marker)) return;
    if (isRepo) {
      await postFinalize(c, { status: 'error', tokens: 0, pushed: false, branch: c.branch });
    } else {
      const files = await collectDemoFiles(c.demoDir);
      if (files.length) await finalizeDemo(c, { tokens: 0, status: 'error', files });
    }
    return;
  }

  const { tokens, capped, exitCode } = await runClaude(c);

  if (isRepo) {
    const { pushed, prUrl } = await commitPushPR(c);
    await postFinalize(c, {
      status: repoFinalizeStatus({ pushed, prUrl }),
      tokens,
      prUrl,
      branch: c.branch,
      pushed,
    });
  } else {
    const files = await collectDemoFiles(c.demoDir);
    await finalizeDemo(c, { tokens, status: demoFinalizeStatus({ capped, exitCode }), files });
  }

  try {
    fs.writeFileSync(marker, '1');
  } catch {
    /* ignore */
  }
}

// Run only when executed directly (argv[1] is this file), not when imported by a test.
const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  main().catch((err) => {
    console.error('[cloud-run] fatal', err);
    process.exit(1);
  });
}
