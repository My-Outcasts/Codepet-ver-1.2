#!/usr/bin/env node
// Codepet live-activity hook. Claude Code runs this on SessionStart / PostToolUse /
// Stop. It reads the hook JSON on stdin, maps the event to a live "kind", and POSTs
// an incremental LiveEvent to Codepet's /api/track/live so the Build Coach DURING
// meter updates in real time. It NEVER blocks or fails the session: every step is
// guarded, the POST has a short timeout, and the process always exits 0.
//
// Only emits while a build is armed: reads <claudeDir>/codepet/current-build.json for
// the active buildSessionId (written by the arm-session server action). If absent, no-op.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { narrate, extractLastAssistantText } from './narrate.mjs';

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function kindFor(name) {
  if (name === 'SessionStart') return 'start';
  if (name === 'PostToolUse') return 'tool';
  if (name === 'Stop') return 'turn';
  if (name === 'Notification') return 'ask';
  return null;
}

async function main() {
  let input = {};
  try {
    input = JSON.parse(readStdin() || '{}');
  } catch {
    return;
  }
  const kind = kindFor(input.hook_event_name);
  if (!kind) return;

  const claudeDir = process.env.CODEPET_CLAUDE_DIR || path.join(os.homedir(), '.claude');
  let build;
  let cfg;
  try {
    build = JSON.parse(
      fs.readFileSync(path.join(claudeDir, 'codepet', 'current-build.json'), 'utf8'),
    );
    cfg = JSON.parse(fs.readFileSync(path.join(claudeDir, 'codepet', 'track.json'), 'utf8'));
  } catch {
    return; // no active build or no config — nothing to do
  }
  if (!build?.buildSessionId) return;
  if (!cfg?.companyId || !cfg?.token || !cfg?.apiUrl) return;
  if (cfg.enabled === false) return;

  const event = {
    buildSessionId: build.buildSessionId,
    sessionId: input.session_id || `sess-${Date.now()}`,
    kind,
    ts: Date.now(),
  };
  if (kind === 'tool') {
    event.tool = input.tool_name;
  } else if (kind === 'turn') {
    // Narrate what Claude just said — locally, so the raw text never leaves the
    // machine. Any failure just omits `say`; the turn still counts.
    try {
      if (input.transcript_path) {
        const line = narrate(extractLastAssistantText(fs.readFileSync(input.transcript_path, 'utf8')));
        if (line) event.say = line;
      }
    } catch {
      // transcript unreadable — emit the bare turn
    }
  } else if (kind === 'ask') {
    event.ask = "Claude's waiting on you — hop back to the Terminal and answer 🙋";
  }

  try {
    await fetch(`${cfg.apiUrl.replace(/\/$/, '')}/api/track/live`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ companyId: cfg.companyId, token: cfg.token, event }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // best-effort — a failed POST must never disrupt Claude Code
  }
}

main().finally(() => process.exit(0));
