import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { startSession, stopSession, CLAUDE_ARGS } from './engine';
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

    expect(spawnFn).toHaveBeenCalledWith('claude', CLAUDE_ARGS, { cwd: '/proj' });
    // opening prompt written as a stream-json user message, then stdin closed (P1 one-shot).
    expect(child.stdin.writes.length).toBe(1);
    const sent = JSON.parse(child.stdin.writes[0]);
    expect(sent).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'build X' }] },
    });
    expect(child.stdin.ended).toBe(true);
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
