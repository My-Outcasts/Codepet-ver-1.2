// Spawns and manages the real `claude` CLI headless for a build session. Pipes its
// stream-json stdout through the pure parser onto a per-session emitter, buffering
// events for replay. Phase 1 is one-shot: write the opening prompt, close stdin, let
// claude run the turn and exit. `spawnFn` is injectable so this is unit-tested with a
// fake child (no real binary). See the in-UI Claude session design spec.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { StreamParser, type SessionEvent } from './parseEvents';
import { getSession, setSession, deleteSession, type LiveSession } from './registry';

/** Headless streaming args. `acceptEdits` is the Phase 1 permission mode (UI
 *  permission prompts arrive in Phase 3). */
export const CLAUDE_ARGS = [
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--permission-mode',
  'acceptEdits',
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

export function startSession(opts: {
  buildSessionId: string;
  projectDir: string;
  openingPrompt: string;
  spawnFn?: SpawnFn;
}): void {
  const spawnFn = opts.spawnFn ?? defaultSpawn;
  const child = spawnFn('claude', CLAUDE_ARGS, { cwd: opts.projectDir });
  const emitter = new EventEmitter();
  const session: LiveSession = { emitter, child, status: 'running', buffer: [] };
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

export function stopSession(buildSessionId: string): void {
  const s = getSession(buildSessionId);
  if (!s) return;
  try {
    s.child.kill();
  } catch {
    // already gone
  }
  deleteSession(buildSessionId);
}
