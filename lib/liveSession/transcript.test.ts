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

  it('ends on result and error on error/exit', () => {
    expect(run([{ kind: 'result', text: 'done', sessionId: 's' }]).status).toBe('ended');
    expect(run([{ kind: 'error', message: 'boom' }]).status).toBe('error');
    const ex = run([{ kind: 'exit', code: 1 }]);
    expect(ex.status).toBe('error');
    const ok = run([
      { kind: 'result', text: 'd', sessionId: 's' },
      { kind: 'exit', code: 0 },
    ]);
    expect(ok.status).toBe('ended'); // a clean exit after result stays ended
  });

  it('treats a clean exit before any result as an error', () => {
    expect(run([{ kind: 'exit', code: 0 }]).status).toBe('error');
  });

  it('keeps an existing error when a clean exit follows', () => {
    const s = run([
      { kind: 'error', message: 'boom' },
      { kind: 'exit', code: 0 },
    ]);
    expect(s.status).toBe('error');
    expect(s.error).toBe('boom');
  });

  it('does not mutate the input state', () => {
    const s0 = initialTranscript();
    reduceTranscript(s0, { kind: 'assistant-text', text: 'x' });
    expect(s0.messages).toEqual([]);
  });
});
