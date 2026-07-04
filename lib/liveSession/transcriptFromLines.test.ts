import { describe, it, expect } from 'vitest';
import { applyLine, applyUserTurn } from './useLiveSession';
import { initialTranscript } from './transcript';

describe('applyLine', () => {
  it('folds a serialized SessionEvent line into the transcript', () => {
    let s = initialTranscript();
    s = applyLine(s, JSON.stringify({ kind: 'init', sessionId: 's1' }));
    s = applyLine(s, JSON.stringify({ kind: 'assistant-text', text: 'hi' }));
    s = applyLine(s, JSON.stringify({ kind: 'tool-use', id: 't1', name: 'Read', input: {} }));
    expect(s.sessionId).toBe('s1');
    expect(s.messages).toEqual([{ role: 'assistant', text: 'hi' }]);
    expect(s.tools.map((t) => t.name)).toEqual(['Read']);
    expect(s.actionCount).toBe(1);
  });

  it('ignores a blank or malformed line (same reference)', () => {
    const s0 = initialTranscript();
    expect(applyLine(s0, '')).toBe(s0);
    expect(applyLine(s0, '{bad')).toBe(s0);
    expect(applyLine(s0, JSON.stringify({ no: 'kind' }))).toBe(s0);
  });
});

describe('applyUserTurn', () => {
  it('appends the user message and sets running', () => {
    const s = applyUserTurn(initialTranscript(), 'now add tests');
    expect(s.messages).toEqual([{ role: 'user', text: 'now add tests' }]);
    expect(s.status).toBe('running');
  });
});
