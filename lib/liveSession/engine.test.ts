import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  startSession,
  stopSession,
  sendTurn,
  CLAUDE_ARGS,
  enqueuePermission,
  resolvePermission,
  PERMISSION_TIMEOUT_MS,
} from './engine';
import { getSession } from './registry';
import type { SessionEvent } from './parseEvents';

// A fake `claude` child: stdout/stderr are EventEmitters, stdin records writes.
function fakeChild() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { writes: string[]; ended: boolean; write(s: string): void; end(): void };
    kill(): void;
    killed: boolean;
  };
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.killed = false;
  proc.stdin = {
    writes: [],
    ended: false,
    write(s: string) {
      this.writes.push(s);
    },
    end() {
      this.ended = true;
    },
  };
  proc.kill = () => {
    proc.killed = true;
  };
  return proc;
}

describe('startSession', () => {
  it('spawns claude with the streaming args in the project dir and writes the opening prompt', () => {
    const child = fakeChild();
    const spawnFn = vi.fn(() => child) as never;
    startSession({ buildSessionId: 'b1', projectDir: '/proj', openingPrompt: 'build X', spawnFn });

    expect(spawnFn).toHaveBeenCalledWith(
      'claude',
      [
        ...CLAUDE_ARGS,
        '--permission-mode',
        'default',
        '--permission-prompt-tool',
        'mcp__codepet_permit__codepet_permit',
        '--mcp-config',
        expect.any(String),
      ],
      { cwd: '/proj', env: expect.any(Object) },
    );
    // opening prompt written as a stream-json user message, then stdin closed (P1 one-shot).
    expect(child.stdin.writes.length).toBe(1);
    const sent = JSON.parse(child.stdin.writes[0]);
    expect(sent).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'build X' }] },
    });
    expect(child.stdin.ended).toBe(false);
  });

  it('runs claude as the user: strips ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN from the child env', () => {
    const prevKey = process.env.ANTHROPIC_API_KEY;
    const prevTok = process.env.ANTHROPIC_AUTH_TOKEN;
    process.env.ANTHROPIC_API_KEY = 'sk-should-not-leak';
    process.env.ANTHROPIC_AUTH_TOKEN = 'tok-should-not-leak';
    try {
      const child = fakeChild();
      const spawnFn = vi.fn(() => child) as never;
      startSession({ buildSessionId: 'benv', projectDir: '/p', openingPrompt: 'x', spawnFn });
      const call = (spawnFn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
      const optsArg = call[2] as { env?: Record<string, string | undefined> };
      expect(optsArg.env).toBeDefined();
      // The app's server auth must NOT leak into the user's claude session…
      expect(optsArg.env!.ANTHROPIC_API_KEY).toBeUndefined();
      expect(optsArg.env!.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      // …but the rest of the environment (e.g. PATH, so `claude` resolves) is inherited.
      expect(optsArg.env!.PATH).toBe(process.env.PATH);
    } finally {
      if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prevKey;
      if (prevTok === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
      else process.env.ANTHROPIC_AUTH_TOKEN = prevTok;
    }
  });

  it('parses stdout into events on the session emitter and buffers them', () => {
    const child = fakeChild();
    const events: SessionEvent[] = [];
    startSession({
      buildSessionId: 'b2',
      projectDir: '/p',
      openingPrompt: 'x',
      spawnFn: (() => child) as never,
    });
    getSession('b2')!.emitter.on('event', (e: SessionEvent) => events.push(e));

    child.stdout.emit(
      'data',
      Buffer.from(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's9' }) + '\n'),
    );
    child.stdout.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'hey' }] },
        }) + '\n',
      ),
    );

    expect(events).toEqual([
      { kind: 'init', sessionId: 's9' },
      { kind: 'assistant-text', text: 'hey' },
    ]);
    expect(getSession('b2')!.buffer).toEqual(events);
  });

  it('emits an exit event and marks the session ended when the child closes', () => {
    const child = fakeChild();
    const events: SessionEvent[] = [];
    startSession({
      buildSessionId: 'b3',
      projectDir: '/p',
      openingPrompt: 'x',
      spawnFn: (() => child) as never,
    });
    getSession('b3')!.emitter.on('event', (e: SessionEvent) => events.push(e));
    child.emit('close', 0);
    expect(events).toContainEqual({ kind: 'exit', code: 0 });
  });

  it('stopSession kills the child and deletes the registry entry', () => {
    const child = fakeChild();
    startSession({
      buildSessionId: 'b4',
      projectDir: '/p',
      openingPrompt: 'x',
      spawnFn: (() => child) as never,
    });
    stopSession('b4');
    expect(child.killed).toBe(true);
    expect(getSession('b4')).toBeUndefined();
  });
});

describe('two-way session', () => {
  it('startSession keeps stdin open (does not end it)', () => {
    const child = fakeChild();
    startSession({
      buildSessionId: 'tw1',
      projectDir: '/p',
      openingPrompt: 'x',
      spawnFn: (() => child) as never,
    });
    expect(child.stdin.writes.length).toBe(1); // opening prompt
    expect(child.stdin.ended).toBe(false); // stays open for follow-ups
  });

  it('a result event does not mark the session ended (still awaiting input)', () => {
    const child = fakeChild();
    startSession({
      buildSessionId: 'tw2',
      projectDir: '/p',
      openingPrompt: 'x',
      spawnFn: (() => child) as never,
    });
    child.stdout.emit(
      'data',
      Buffer.from(
        JSON.stringify({ type: 'result', subtype: 'success', result: 'done', session_id: 's' }) +
          '\n',
      ),
    );
    expect(getSession('tw2')!.status).toBe('running');
  });

  it('sendTurn writes a user-turn line to stdin and returns true', () => {
    const child = fakeChild();
    startSession({
      buildSessionId: 'tw3',
      projectDir: '/p',
      openingPrompt: 'x',
      spawnFn: (() => child) as never,
    });
    const ok = sendTurn('tw3', 'now write tests');
    expect(ok).toBe(true);
    const sent = JSON.parse(child.stdin.writes[1]);
    expect(sent).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'now write tests' }] },
    });
  });

  it('sendTurn on a missing session returns false', () => {
    expect(sendTurn('nope', 'hi')).toBe(false);
  });

  it('sendTurn after the session errored returns false', () => {
    const child = fakeChild();
    startSession({
      buildSessionId: 'tw4',
      projectDir: '/p',
      openingPrompt: 'x',
      spawnFn: (() => child) as never,
    });
    child.emit('close', 1); // non-zero exit → error
    expect(sendTurn('tw4', 'hi')).toBe(false);
  });
});

describe('permission bridge', () => {
  it('enqueue emits a permission-request and resolves when the user decides', async () => {
    const child = fakeChild();
    const events: SessionEvent[] = [];
    startSession({
      buildSessionId: 'pm1',
      projectDir: '/p',
      openingPrompt: 'x',
      spawnFn: (() => child) as never,
    });
    getSession('pm1')!.emitter.on('event', (e: SessionEvent) => events.push(e));

    const p = enqueuePermission('pm1', { requestId: 'r1', tool: 'Bash', input: { command: 'ls' } });
    expect(events).toContainEqual({
      kind: 'permission-request',
      requestId: 'r1',
      tool: 'Bash',
      input: { command: 'ls' },
    });

    const resolved = resolvePermission('pm1', 'r1', { decision: 'allow' });
    expect(resolved).toBe(true);
    await expect(p).resolves.toEqual({ decision: 'allow' });
  });

  it('enqueue on a missing session resolves to deny', async () => {
    await expect(
      enqueuePermission('nope', { requestId: 'r', tool: 'X', input: {} }),
    ).resolves.toEqual({
      decision: 'deny',
      reason: 'no such session',
    });
  });

  it('resolvePermission for an unknown request returns false', () => {
    const child = fakeChild();
    startSession({
      buildSessionId: 'pm2',
      projectDir: '/p',
      openingPrompt: 'x',
      spawnFn: (() => child) as never,
    });
    expect(resolvePermission('pm2', 'ghost', { decision: 'allow' })).toBe(false);
  });

  it('spawns claude with the permission-prompt-tool wiring (no acceptEdits)', () => {
    const child = fakeChild();
    const spawnFn = vi.fn(() => child) as never;
    startSession({ buildSessionId: 'pm3', projectDir: '/p', openingPrompt: 'x', spawnFn });
    const args: string[] = (spawnFn as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][1] as string[];
    expect(args).not.toContain('acceptEdits');
    // Must run in `default` mode (not bypassPermissions) so tool calls are actually
    // gated by the Allow/Deny card instead of running unattended.
    expect(args).toContain('--permission-mode');
    expect(args).toContain('default');
    expect(args).toContain('--permission-prompt-tool');
    // Claude Code needs the fully-qualified MCP tool name (mcp__<server>__<tool>),
    // not the bare tool name, or it errors "MCP tool codepet_permit ... not found".
    expect(args).toContain('mcp__codepet_permit__codepet_permit');
    expect(args).toContain('--mcp-config');
  });

  it('co-pilot auto-allows non-risky tools but still gates risky ones', async () => {
    const child = fakeChild();
    startSession({
      buildSessionId: 'cop1',
      projectDir: '/p',
      openingPrompt: 'x',
      mode: 'copilot',
      spawnFn: (() => child) as never,
    });
    // safe/careful → auto-allowed, no card
    await expect(
      enqueuePermission('cop1', { requestId: 'r1', tool: 'Read', input: { file_path: '/a' } }),
    ).resolves.toEqual({ decision: 'allow' });
    // risky → still parked for the user
    const p = enqueuePermission('cop1', {
      requestId: 'r2',
      tool: 'Bash',
      input: { command: 'rm -rf x' },
    });
    expect(resolvePermission('cop1', 'r2', { decision: 'deny' })).toBe(true);
    await expect(p).resolves.toEqual({ decision: 'deny' });
  });

  it('autopilot spawns claude with bypassPermissions', () => {
    const child = fakeChild();
    const spawnFn = vi.fn(() => child) as never;
    startSession({
      buildSessionId: 'auto1',
      projectDir: '/p',
      openingPrompt: 'x',
      mode: 'autopilot',
      spawnFn,
    });
    const args = (spawnFn as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][1] as string[];
    const i = args.indexOf('--permission-mode');
    expect(args[i + 1]).toBe('bypassPermissions');
  });
});

it('PERMISSION_TIMEOUT_MS is a positive number', () => {
  expect(PERMISSION_TIMEOUT_MS).toBeGreaterThan(0);
});
