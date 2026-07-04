// Spawns and manages the real `claude` CLI headless for a build session. Pipes its
// stream-json stdout through the pure parser onto a per-session emitter, buffering
// events for replay. Phase 1 is one-shot: write the opening prompt, close stdin, let
// claude run the turn and exit. `spawnFn` is injectable so this is unit-tested with a
// fake child (no real binary). See the in-UI Claude session design spec.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StreamParser, type SessionEvent } from './parseEvents';
import { getSession, setSession, deleteSession, type LiveSession } from './registry';
import type { PermissionDecision } from './registry';

export const PERMISSION_TIMEOUT_MS = 120_000;

/** Base headless streaming args. The permission wiring (--permission-prompt-tool +
 *  --mcp-config) is appended per session in startSession, since the mcp-config path
 *  is session-specific. */
export const CLAUDE_ARGS = [
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
];

interface ChildLike {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write(s: string): void; end(): void };
  on(event: string, cb: (arg?: unknown) => void): void;
  kill(): void;
}
export type SpawnFn = (cmd: string, args: string[], opts: { cwd: string }) => ChildLike;

const defaultSpawn: SpawnFn = (cmd, args, opts) =>
  spawn(cmd, args, { cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] }) as unknown as ChildLike;

/** One user turn, encoded as a stream-json input line. */
function userLine(text: string): string {
  return (
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) +
    '\n'
  );
}

/** Write a per-session MCP config that launches the permission bridge server for
 *  this build session. The server reads CODEPET_BUILD_SESSION_ID + CODEPET_API_URL
 *  to call back into the app. Returns the config file path. */
function writeMcpConfig(buildSessionId: string): string {
  const serverPath = path.join(process.cwd(), 'lib', 'liveSession', 'permissionServer.mjs');
  const cfg = {
    mcpServers: {
      codepet_permit: {
        command: 'node',
        args: [serverPath],
        env: {
          CODEPET_BUILD_SESSION_ID: buildSessionId,
          CODEPET_API_URL: process.env.CODEPET_API_URL || 'http://127.0.0.1:3000',
        },
      },
    },
  };
  const file = path.join(os.tmpdir(), `codepet-mcp-${buildSessionId}.json`);
  fs.writeFileSync(file, JSON.stringify(cfg));
  return file;
}

export function startSession(opts: {
  buildSessionId: string;
  projectDir: string;
  openingPrompt: string;
  spawnFn?: SpawnFn;
}): void {
  const spawnFn = opts.spawnFn ?? defaultSpawn;
  const mcpConfigPath = writeMcpConfig(opts.buildSessionId);
  const args = [
    ...CLAUDE_ARGS,
    '--permission-prompt-tool',
    'codepet_permit',
    '--mcp-config',
    mcpConfigPath,
  ];
  const child = spawnFn('claude', args, { cwd: opts.projectDir });
  const emitter = new EventEmitter();
  const session: LiveSession = {
    emitter,
    child,
    status: 'running',
    buffer: [],
    pending: new Map(),
  };
  setSession(opts.buildSessionId, session);

  const emit = (e: SessionEvent) => {
    session.buffer.push(e);
    if (e.kind === 'error' || (e.kind === 'exit' && e.code !== 0)) session.status = 'error';
    if (e.kind === 'exit' && e.code === 0) session.status = 'ended';
    emitter.emit('event', e);
  };

  const parser = new StreamParser();
  child.stdout.on('data', (chunk: Buffer) => {
    for (const e of parser.push(chunk.toString('utf8'))) emit(e);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    const msg = chunk.toString('utf8').trim();
    if (msg) emit({ kind: 'error', message: msg });
  });
  child.on('error', (err) =>
    emit({ kind: 'error', message: err instanceof Error ? err.message : String(err) }),
  );
  child.on('close', (code) => emit({ kind: 'exit', code: typeof code === 'number' ? code : null }));

  // Send the opening prompt. Phase 2: keep stdin OPEN so follow-up turns can be
  // written via sendTurn; the session ends on stopSession or child exit.
  child.stdin.write(userLine(opts.openingPrompt));
}

/** Write a follow-up user turn to the live child's stdin. No-op (returns false)
 *  if the session is missing or no longer running. */
export function sendTurn(buildSessionId: string, text: string): boolean {
  const s = getSession(buildSessionId);
  if (!s || s.status !== 'running') return false;
  try {
    s.child.stdin.write(userLine(text));
    return true;
  } catch {
    return false;
  }
}

/** Park a permission request: emit it to the UI and return a promise that resolves
 *  when the user decides (via resolvePermission) or after PERMISSION_TIMEOUT_MS
 *  (auto-deny). A missing session resolves to deny immediately. */
export function enqueuePermission(
  buildSessionId: string,
  req: { requestId: string; tool: string; input: unknown },
): Promise<PermissionDecision> {
  const s = getSession(buildSessionId);
  if (!s) return Promise.resolve({ decision: 'deny', reason: 'no such session' });
  return new Promise<PermissionDecision>((resolve) => {
    let done = false;
    const finish = (d: PermissionDecision) => {
      if (done) return;
      done = true;
      s.pending.delete(req.requestId);
      resolve(d);
    };
    s.pending.set(req.requestId, finish);
    setTimeout(() => finish({ decision: 'deny', reason: 'timed out' }), PERMISSION_TIMEOUT_MS);
    // Emit through the same buffer/emitter path so the stream + UI see it.
    const event = {
      kind: 'permission-request' as const,
      requestId: req.requestId,
      tool: req.tool,
      input: req.input,
    };
    s.buffer.push(event);
    s.emitter.emit('event', event);
  });
}

/** Resolve a parked permission with the user's decision. False if not found. */
export function resolvePermission(
  buildSessionId: string,
  requestId: string,
  decision: PermissionDecision,
): boolean {
  const s = getSession(buildSessionId);
  const resolver = s?.pending.get(requestId);
  if (!resolver) return false;
  resolver(decision);
  return true;
}

export function stopSession(buildSessionId: string): void {
  const s = getSession(buildSessionId);
  if (!s) return;
  try {
    s.child.kill();
  } catch {
    // already gone
  }
  try {
    fs.rmSync(path.join(os.tmpdir(), `codepet-mcp-${buildSessionId}.json`), { force: true });
  } catch {
    // best-effort temp cleanup
  }
  deleteSession(buildSessionId);
}
