#!/usr/bin/env node
// Codepet SessionEnd hook. Claude Code runs this when a session ends; it reads the
// hook JSON on stdin, gathers a lightweight git rollup of the work done, and POSTs
// it to Codepet's /api/track. It NEVER blocks or fails the session: every step is
// guarded and the process always exits 0.
//
// Config lives at <claudeDir>/codepet/track.json: { companyId, token, apiUrl }.
// The installer writes it with the signed-in company's ingest token.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const SINCE = '12 hours ago'; // rough session window — we don't get a start time on stdin

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function sh(cmd, cwd) {
  try {
    return execSync(cmd, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
  } catch {
    return '';
  }
}

function gitRollup(cwd) {
  const inRepo = sh('git rev-parse --is-inside-work-tree', cwd) === 'true';
  if (!inRepo)
    return { commits: 0, prs: 0, linesAdded: 0, linesRemoved: 0, wins: [], branch: undefined };

  const subjects = sh(`git log --since="${SINCE}" --pretty=format:%s`, cwd);
  const wins = subjects ? subjects.split('\n').filter(Boolean) : [];

  let linesAdded = 0;
  let linesRemoved = 0;
  const numstat = sh(`git log --since="${SINCE}" --numstat --pretty=tformat:`, cwd);
  if (numstat) {
    for (const line of numstat.split('\n')) {
      const [a, r] = line.split('\t');
      const na = parseInt(a, 10);
      const nr = parseInt(r, 10);
      if (Number.isFinite(na)) linesAdded += na;
      if (Number.isFinite(nr)) linesRemoved += nr;
    }
  }

  // PRs created today, best-effort via gh (skipped silently if gh is absent).
  let prs = 0;
  const today = new Date().toISOString().slice(0, 10);
  const ghOut = sh(
    `gh pr list --author @me --state all --search "created:>=${today}" --json number -L 50`,
    cwd,
  );
  if (ghOut) {
    try {
      prs = JSON.parse(ghOut).length;
    } catch {
      prs = 0;
    }
  }

  const branch = sh('git rev-parse --abbrev-ref HEAD', cwd) || undefined;
  return { commits: wins.length, prs, linesAdded, linesRemoved, wins: wins.slice(0, 10), branch };
}

async function main() {
  let input = {};
  try {
    input = JSON.parse(readStdin() || '{}');
  } catch {
    input = {};
  }

  const claudeDir = process.env.CODEPET_CLAUDE_DIR || path.join(os.homedir(), '.claude');
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(claudeDir, 'codepet', 'track.json'), 'utf8'));
  } catch {
    return; // not configured — nothing to do
  }
  if (!cfg?.companyId || !cfg?.token || !cfg?.apiUrl) return;
  if (cfg.enabled === false) return; // tracking paused from Settings (fail-safe: only explicit false)

  const cwd = input.cwd || process.cwd();
  const roll = gitRollup(cwd);
  const event = {
    sessionId: input.session_id || `sess-${Date.now()}`,
    cwd,
    repo: path.basename(cwd),
    ...roll,
  };

  try {
    await fetch(`${cfg.apiUrl.replace(/\/$/, '')}/api/track`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ companyId: cfg.companyId, token: cfg.token, event }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // best-effort — a failed POST must never disrupt Claude Code
  }
}

main().finally(() => process.exit(0));
