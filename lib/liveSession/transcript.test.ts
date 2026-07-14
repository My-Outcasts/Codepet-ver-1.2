import { describe, it, expect } from 'vitest';
import { initialTranscript, reduceTranscript, type TranscriptState } from './transcript';
import type { SessionEvent } from './parseEvents';

const run = (events: SessionEvent[]): TranscriptState =>
  events.reduce(reduceTranscript, initialTranscript());

describe('reduceTranscript', () => {
  it('starts empty and running', () => {
    const s = initialTranscript();
    expect(s.status).toBe('running');
    expect(s.messages).toEqual([]);
    expect(s.tools).toEqual([]);
    expect(s.actionCount).toBe(0);
  });

  it('records the session id from init', () => {
    expect(run([{ kind: 'init', sessionId: 's1' }]).sessionId).toBe('s1');
  });

  it('appends assistant text as messages', () => {
    const s = run([
      { kind: 'assistant-text', text: 'hi' },
      { kind: 'assistant-text', text: 'again' },
    ]);
    expect(s.messages).toEqual([
      { role: 'assistant', text: 'hi' },
      { role: 'assistant', text: 'again' },
    ]);
  });

  it('adds a tool on tool-use and bumps actionCount', () => {
    const s = run([{ kind: 'tool-use', id: 't1', name: 'Read', input: { file_path: '/a' } }]);
    expect(s.tools).toEqual([{ id: 't1', name: 'Read', input: { file_path: '/a' } }]);
    expect(s.actionCount).toBe(1);
  });

  it('attaches a matching tool-result to its tool without adding an action', () => {
    const s = run([
      { kind: 'tool-use', id: 't1', name: 'Read', input: {} },
      { kind: 'tool-result', id: 't1', ok: true, summary: 'body' },
    ]);
    expect(s.tools).toEqual([{ id: 't1', name: 'Read', input: {}, ok: true, summary: 'body' }]);
    expect(s.actionCount).toBe(1);
  });

  it('a result means the turn is done and the session awaits input', () => {
    const s = run([{ kind: 'result', text: 'done', sessionId: 's' }]);
    expect(s.status).toBe('awaiting-input');
  });

  it('a user-text turn appends a user message and returns to running', () => {
    const s = run([
      { kind: 'result', text: 'done', sessionId: 's' },
      { kind: 'user-text', text: 'now add tests' },
    ]);
    expect(s.messages).toEqual([{ role: 'user', text: 'now add tests' }]);
    expect(s.status).toBe('running');
  });

  it('a clean exit ends the session; a non-zero exit errors', () => {
    expect(run([{ kind: 'exit', code: 0 }]).status).toBe('ended');
    expect(run([{ kind: 'exit', code: 1 }]).status).toBe('error');
  });

  it('error stands, and a later clean exit does not overwrite it', () => {
    const s = run([
      { kind: 'error', message: 'boom' },
      { kind: 'exit', code: 0 },
    ]);
    expect(s.status).toBe('error');
    expect(s.error).toBe('boom');
  });

  it('interleaves user and assistant messages in order', () => {
    const s = run([
      { kind: 'assistant-text', text: 'hi' },
      { kind: 'result', text: '', sessionId: 's' },
      { kind: 'user-text', text: 'more please' },
      { kind: 'assistant-text', text: 'ok' },
    ]);
    expect(s.messages).toEqual([
      { role: 'assistant', text: 'hi' },
      { role: 'user', text: 'more please' },
      { role: 'assistant', text: 'ok' },
    ]);
  });

  it('sums usage events into tokens', () => {
    let s = initialTranscript();
    expect(s.tokens).toBe(0);
    s = reduceTranscript(s, { kind: 'usage', tokens: 18 });
    s = reduceTranscript(s, { kind: 'usage', tokens: 7 });
    expect(s.tokens).toBe(25);
  });

  it('does not mutate the input state', () => {
    const s0 = initialTranscript();
    reduceTranscript(s0, { kind: 'assistant-text', text: 'x' });
    expect(s0.messages).toEqual([]);
  });

  it('a permission-request parks a pending permission and awaits it', () => {
    const s = run([
      { kind: 'permission-request', requestId: 'r1', tool: 'Bash', input: { command: 'ls' } },
    ]);
    expect(s.pendingPermission).toEqual({
      requestId: 'r1',
      tool: 'Bash',
      input: { command: 'ls' },
    });
    expect(s.status).toBe('awaiting-permission');
  });

  it('a tool-use clears a pending permission and returns to running', () => {
    const s = run([
      { kind: 'permission-request', requestId: 'r1', tool: 'Bash', input: {} },
      { kind: 'tool-use', id: 't1', name: 'Bash', input: {} },
    ]);
    expect(s.pendingPermission).toBeUndefined();
    expect(s.status).toBe('running');
  });

  it('an error clears a pending permission', () => {
    const s = run([
      { kind: 'permission-request', requestId: 'r1', tool: 'Bash', input: {} },
      { kind: 'error', message: 'boom' },
    ]);
    expect(s.pendingPermission).toBeUndefined();
    expect(s.status).toBe('error');
  });

  it('a deny that continues as assistant text clears the stale permission card', () => {
    const s = run([
      { kind: 'permission-request', requestId: 'r1', tool: 'Bash', input: {} },
      { kind: 'assistant-text', text: 'ok, skipping that' },
    ]);
    expect(s.pendingPermission).toBeUndefined();
  });

  it('a result clears a pending permission', () => {
    const s = run([
      { kind: 'permission-request', requestId: 'r1', tool: 'Bash', input: {} },
      { kind: 'result', text: 'done', sessionId: 's' },
    ]);
    expect(s.pendingPermission).toBeUndefined();
  });
});
