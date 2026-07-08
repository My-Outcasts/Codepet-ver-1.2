import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { initialTranscript, reduceTranscript } from './transcript';
import { applyAnswer } from './useLiveSession';
import { friendlyClaudeError } from './friendlyError';
import { startSession, enqueueQuestion, resolveQuestion, stopSession } from './engine';
import type { SessionEvent } from './parseEvents';

const q: SessionEvent = {
  kind: 'question',
  requestId: 'r1',
  question: 'Which login method?',
  options: ['Email', 'Google'],
};

describe('transcript question flow', () => {
  it('a question event parks the card and flips status', () => {
    const s = reduceTranscript(initialTranscript(), q);
    expect(s.status).toBe('awaiting-question');
    expect(s.pendingQuestion).toMatchObject({ requestId: 'r1', options: ['Email', 'Google'] });
  });

  it('the next non-question event clears a pending question (replay-safe)', () => {
    const s = reduceTranscript(initialTranscript(), q);
    const after = reduceTranscript(s, { kind: 'assistant-text', text: 'ok, email it is' });
    expect(after.pendingQuestion).toBeUndefined();
    expect(after.status).toBe('running');
  });

  it('applyAnswer optimistically records the answer as the user turn', () => {
    const s = reduceTranscript(initialTranscript(), q);
    const answered = applyAnswer(s, 'Email');
    expect(answered.pendingQuestion).toBeUndefined();
    expect(answered.status).toBe('running');
    expect(answered.messages.at(-1)).toEqual({ role: 'user', text: 'Email' });
    // No pending question → no-op.
    expect(applyAnswer(initialTranscript(), 'x')).toEqual(initialTranscript());
  });
});

// A fake `claude` child, matching engine.test.ts's shape.
function fakeChild() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write(s: string): void; end(): void };
    kill(): void;
    pid?: number;
  };
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.stdin = { write: () => {}, end: () => {} };
  proc.kill = () => {};
  return proc;
}

describe('engine question queue', () => {
  it('parks a question, emits the event, and resolves with the answer', async () => {
    const id = `q-test-${Math.random()}`;
    startSession({
      buildSessionId: id,
      projectDir: '/tmp',
      openingPrompt: 'go',
      spawnFn: () => fakeChild(),
    });
    const events: SessionEvent[] = [];
    const p = enqueueQuestion(id, { requestId: 'r9', question: 'Pick one', options: ['a', 'b'] });
    // The event landed in the replay buffer for (re)connecting streams.
    const { getSession } = await import('./registry');
    const buffered = getSession(id)!.buffer.find((e) => e.kind === 'question');
    expect(buffered).toMatchObject({ requestId: 'r9', question: 'Pick one' });
    expect(resolveQuestion(id, 'r9', 'a')).toBe(true);
    await expect(p).resolves.toEqual({ answer: 'a' });
    // Already resolved → gone.
    expect(resolveQuestion(id, 'r9', 'b')).toBe(false);
    stopSession(id);
    void events;
  });

  it('a missing session answers null immediately', async () => {
    await expect(enqueueQuestion('nope', { requestId: 'x', question: 'hm' })).resolves.toEqual({
      answer: null,
    });
  });

  it('times out to a null answer', async () => {
    vi.useFakeTimers();
    try {
      const id = `q-timeout-${Math.random()}`;
      startSession({
        buildSessionId: id,
        projectDir: '/tmp',
        openingPrompt: 'go',
        spawnFn: () => fakeChild(),
      });
      const p = enqueueQuestion(id, { requestId: 'r1', question: 'still there?' });
      vi.runAllTimers();
      await expect(p).resolves.toEqual({ answer: null });
      stopSession(id);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('friendlyClaudeError', () => {
  it('maps not-installed and not-logged-in errors to actionable hints', () => {
    expect(friendlyClaudeError('spawn claude ENOENT')).toMatch(/isn’t installed/);
    expect(friendlyClaudeError('Invalid API key · Please run /login')).toMatch(/signed in/);
    expect(friendlyClaudeError('some other failure')).toBeNull();
  });
});
