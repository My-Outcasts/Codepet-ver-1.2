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
import { permissionModeFor, autoAllows, riskLevel, type Autonomy } from './permissionSummary';

export const PERMISSION_TIMEOUT_MS = 120_000;
/** How long a codepet_ask question waits for the user before Claude is told to
 *  proceed on its own judgment. Longer than permissions — questions are rarer
 *  and the founder may be reading. */
export const ASK_TIMEOUT_MS = 600_000;

/** MCP server key that hosts the permission-prompt tool (see writeMcpConfig). */
const PERMIT_SERVER = 'codepet_permit';
/** The fully-qualified name Claude Code exposes an MCP tool under is
 *  `mcp__<serverKey>__<toolName>`. Our server (key PERMIT_SERVER) registers one tool
 *  also named codepet_permit (see permissionServer.mjs). `--permission-prompt-tool`
 *  MUST get this qualified name, not the bare tool name, or claude errors with
 *  "MCP tool codepet_permit ... not found". */
const PERMIT_TOOL = `mcp__${PERMIT_SERVER}__codepet_permit`;
/** The question tool on the same server (see permissionServer.mjs). */
const ASK_TOOL = `mcp__${PERMIT_SERVER}__codepet_ask`;

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
  // `--permission-mode` is appended per session in startSession, from the autonomy
  // level (default for suggest/copilot so tool calls route through the card; bypass
  // for autopilot).
];

interface ChildLike {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write(s: string): void; end(): void };
  on(event: string, cb: (arg?: unknown) => void): void;
  kill(): void;
  pid?: number;
}
export type SpawnFn = (
  cmd: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv },
) => ChildLike;

const defaultSpawn: SpawnFn = (cmd, args, opts) =>
  spawn(cmd, args, {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as unknown as ChildLike;

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
      [PERMIT_SERVER]: {
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

/** On-disk record of live children, so a restarted server can put down orphans
 *  (their stdio pipes died with the old process — they can't be re-adopted, only
 *  stopped so an unsupervised claude never keeps editing code). */
export function sessionsFilePath(): string {
  return path.join(os.tmpdir(), 'codepet-live-sessions.json');
}

type PidMap = Record<string, number>;

function readPidMap(file: string): PidMap {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return raw && typeof raw === 'object' ? (raw as PidMap) : {};
  } catch {
    return {};
  }
}

function writePidMap(file: string, map: PidMap): void {
  try {
    if (Object.keys(map).length === 0) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, JSON.stringify(map));
  } catch {
    // best-effort — losing the pid file only weakens the orphan sweep
  }
}

export function recordSessionPid(id: string, pid: number | undefined, file = sessionsFilePath()) {
  if (!pid) return;
  const map = readPidMap(file);
  map[id] = pid;
  writePidMap(file, map);
}

export function clearSessionPid(id: string, file = sessionsFilePath()) {
  const map = readPidMap(file);
  if (!(id in map)) return;
  delete map[id];
  writePidMap(file, map);
}

/** Kill children recorded by a previous server process. Entries for sessions this
 *  process knows about are kept; everything else is put down and removed. */
export function sweepOrphanSessions(file = sessionsFilePath()): void {
  const map = readPidMap(file);
  const kept: PidMap = {};
  for (const [id, pid] of Object.entries(map)) {
    if (getSession(id)) {
      kept[id] = pid;
      continue;
    }
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  writePidMap(file, kept);
}

let sweptOnBoot = false;

export function startSession(opts: {
  buildSessionId: string;
  projectDir: string;
  openingPrompt: string;
  mode?: Autonomy;
  spawnFn?: SpawnFn;
}): void {
  // First spawn after a server (re)start: put down any children the previous
  // process left running unsupervised.
  if (!sweptOnBoot) {
    sweptOnBoot = true;
    sweepOrphanSessions();
  }
  const spawnFn = opts.spawnFn ?? defaultSpawn;
  const mode: Autonomy = opts.mode ?? 'suggest';
  const mcpConfigPath = writeMcpConfig(opts.buildSessionId);
  const args = [
    ...CLAUDE_ARGS,
    '--permission-mode',
    permissionModeFor(mode),
    '--permission-prompt-tool',
    PERMIT_TOOL,
    '--mcp-config',
    mcpConfigPath,
    // codepet_ask is how claude asks the founder a question — it must never
    // itself stall on a permission prompt.
    '--allowedTools',
    ASK_TOOL,
  ];
  // Run the child as the user's own claude (their claude.ai login), the same as if
  // they ran `claude` in a terminal. The server sets ANTHROPIC_API_KEY for the chat /
  // build-plan APIs; if the spawned claude inherited it, claude would warn, bill the
  // app's key, and disable the user's claude.ai connectors. Strip it (and any auth
  // token) while keeping the rest of the environment (PATH etc. so `claude` resolves).
  const childEnv = { ...process.env };
  delete childEnv.ANTHROPIC_API_KEY;
  delete childEnv.ANTHROPIC_AUTH_TOKEN;
  const child = spawnFn('claude', args, { cwd: opts.projectDir, env: childEnv });
  const emitter = new EventEmitter();
  const session: LiveSession = {
    emitter,
    child,
    status: 'running',
    buffer: [],
    pending: new Map(),
    pendingAsks: new Map(),
    mode,
  };
  setSession(opts.buildSessionId, session);
  recordSessionPid(opts.buildSessionId, child.pid);

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
  child.on('close', (code) => {
    clearSessionPid(opts.buildSessionId);
    emit({ kind: 'exit', code: typeof code === 'number' ? code : null });
  });

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
  // Co-pilot: auto-approve anything that isn't risky, so only destructive actions
  // interrupt the founder. Doesn't reach the UI (no card) — just proceeds.
  if (autoAllows(s.mode, riskLevel(req.tool, req.input))) {
    return Promise.resolve({ decision: 'allow' });
  }
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

/** Park a codepet_ask question: emit it to the UI and resolve with the user's
 *  answer (via resolveQuestion) or null after ASK_TIMEOUT_MS / missing session —
 *  the bridge then tells claude to proceed on its own judgment. */
export function enqueueQuestion(
  buildSessionId: string,
  req: { requestId: string; question: string; options?: string[] },
): Promise<{ answer: string | null }> {
  const s = getSession(buildSessionId);
  if (!s) return Promise.resolve({ answer: null });
  return new Promise((resolve) => {
    let done = false;
    const finish = (answer: string | null) => {
      if (done) return;
      done = true;
      s.pendingAsks.delete(req.requestId);
      resolve({ answer });
    };
    s.pendingAsks.set(req.requestId, finish);
    setTimeout(() => finish(null), ASK_TIMEOUT_MS);
    const event = {
      kind: 'question' as const,
      requestId: req.requestId,
      question: req.question,
      ...(req.options && req.options.length > 0 ? { options: req.options } : {}),
    };
    s.buffer.push(event);
    s.emitter.emit('event', event);
  });
}

/** Resolve a parked question with the user's answer. False if not found. */
export function resolveQuestion(
  buildSessionId: string,
  requestId: string,
  answer: string,
): boolean {
  const s = getSession(buildSessionId);
  const resolver = s?.pendingAsks.get(requestId);
  if (!resolver) return false;
  resolver(answer);
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
  clearSessionPid(buildSessionId);
  try {
    fs.rmSync(path.join(os.tmpdir(), `codepet-mcp-${buildSessionId}.json`), { force: true });
  } catch {
    // best-effort temp cleanup
  }
  deleteSession(buildSessionId);
}
