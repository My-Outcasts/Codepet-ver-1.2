import { describe, it, expect } from 'vitest';
import { parseEventLine, StreamParser, type SessionEvent } from './parseEvents';

const line = (o: unknown) => JSON.stringify(o);

describe('parseEventLine', () => {
  it('maps a system init line to an init event', () => {
    expect(parseEventLine(line({ type: 'system', subtype: 'init', session_id: 's1' }))).toEqual([
      { kind: 'init', sessionId: 's1' },
    ]);
  });

  it('maps an assistant message to text + tool-use events in order', () => {
    const raw = line({
      type: 'assistant',
      session_id: 's1',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Reading the file' },
          { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a.ts' } },
        ],
      },
    });
    expect(parseEventLine(raw)).toEqual([
      { kind: 'assistant-text', text: 'Reading the file' },
      { kind: 'tool-use', id: 't1', name: 'Read', input: { file_path: '/a.ts' } },
    ]);
  });

  it('maps a user tool_result message to a tool-result event', () => {
    const raw = line({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'file body', is_error: false },
        ],
      },
    });
    expect(parseEventLine(raw)).toEqual([
      { kind: 'tool-result', id: 't1', ok: true, summary: 'file body' },
    ]);
  });

  it('marks an errored tool result', () => {
    const raw = line({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't2', content: 'boom', is_error: true }],
      },
    });
    expect(parseEventLine(raw)).toEqual([
      { kind: 'tool-result', id: 't2', ok: false, summary: 'boom' },
    ]);
  });

  it('maps a result line to a result event', () => {
    const raw = line({ type: 'result', subtype: 'success', result: 'done', session_id: 's1' });
    expect(parseEventLine(raw)).toEqual([{ kind: 'result', text: 'done', sessionId: 's1' }]);
  });

  it('maps a non-success result subtype to an error event', () => {
    const raw = line({
      type: 'result',
      subtype: 'error_max_turns',
      result: 'hit the limit',
      session_id: 's1',
    });
    expect(parseEventLine(raw)).toEqual([{ kind: 'error', message: 'hit the limit' }]);
  });

  it('maps an is_error result to an error event even with subtype success', () => {
    const raw = line({
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'boom',
      session_id: 's1',
    });
    expect(parseEventLine(raw)).toEqual([{ kind: 'error', message: 'boom' }]);
  });

  it('returns [] for empty, malformed, or unknown lines', () => {
    expect(parseEventLine('')).toEqual([]);
    expect(parseEventLine('   ')).toEqual([]);
    expect(parseEventLine('{not json')).toEqual([]);
    expect(parseEventLine(line({ type: 'whatever' }))).toEqual([]);
  });

  it('flattens tool_result content given as an array of blocks', () => {
    const raw = line({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't3',
            content: [{ type: 'text', text: 'part' }],
            is_error: false,
          },
        ],
      },
    });
    expect(parseEventLine(raw)).toEqual([
      { kind: 'tool-result', id: 't3', ok: true, summary: 'part' },
    ]);
  });
});

describe('StreamParser', () => {
  it('emits events only for completed newline-terminated lines', () => {
    const p = new StreamParser();
    const first = p.push(
      line({ type: 'system', subtype: 'init', session_id: 's1' }) + '\n' + '{"type":"assis',
    );
    expect(first).toEqual([{ kind: 'init', sessionId: 's1' }]);
    const rest = p.push(
      'tant","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}\n',
    );
    expect(rest).toEqual([{ kind: 'assistant-text', text: 'hi' }]);
  });

  it('ignores blank lines between events', () => {
    const p = new StreamParser();
    const evs = p.push(
      '\n\n' + line({ type: 'result', subtype: 'success', result: 'ok', session_id: 's' }) + '\n',
    );
    expect(evs).toEqual([{ kind: 'result', text: 'ok', sessionId: 's' }]);
  });
});
