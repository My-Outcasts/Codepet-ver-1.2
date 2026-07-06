import { describe, it, expect } from 'vitest';
import { toClaudeMessages, MAX_CHAT_TURNS, type ChatTurn } from './chatMessages';

describe('toClaudeMessages', () => {
  it('maps me→user and byte→assistant in order', () => {
    const history: ChatTurn[] = [
      { role: 'me', text: 'hi' },
      { role: 'byte', text: 'hello' },
      { role: 'me', text: 'what next?' },
    ];
    expect(toClaudeMessages(history)).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'what next?' },
    ]);
  });

  it('drops empty/whitespace turns and trims content', () => {
    const history: ChatTurn[] = [
      { role: 'me', text: '  spaced  ' },
      { role: 'byte', text: '   ' },
      { role: 'me', text: '' },
    ];
    expect(toClaudeMessages(history)).toEqual([{ role: 'user', content: 'spaced' }]);
  });

  it('trims leading assistant turns so the conversation starts with the user', () => {
    const history: ChatTurn[] = [
      { role: 'byte', text: 'standing greeting' },
      { role: 'me', text: 'first real question' },
      { role: 'byte', text: 'answer' },
    ];
    expect(toClaudeMessages(history)).toEqual([
      { role: 'user', content: 'first real question' },
      { role: 'assistant', content: 'answer' },
    ]);
  });

  it('returns empty for an all-byte / all-empty history', () => {
    expect(toClaudeMessages([{ role: 'byte', text: 'hi' }])).toEqual([]);
    expect(toClaudeMessages([])).toEqual([]);
  });

  it('windows to the most recent `max` turns (older turns dropped)', () => {
    const history: ChatTurn[] = Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 === 0 ? 'me' : 'byte',
      text: `turn ${i}`,
    }));
    const out = toClaudeMessages(history, 10);
    expect(out).toHaveLength(10);
    // The last mapped turn is preserved…
    expect(out.at(-1)).toEqual({ role: 'assistant', content: 'turn 39' });
    // …and the oldest kept turn is turn 30 (40 − 10).
    expect(out[0]).toEqual({ role: 'user', content: 'turn 30' });
  });

  it('windows BEFORE trimming leading assistant, so a window starting on byte stays user-first', () => {
    // With max=3, the last 3 mapped turns are byte,me,byte → trimming the leading byte
    // leaves me,byte (a valid user-first pair), not an assistant-led conversation.
    const history: ChatTurn[] = [
      { role: 'me', text: 'q1' },
      { role: 'byte', text: 'a1' },
      { role: 'me', text: 'q2' },
      { role: 'byte', text: 'a2' }, // window start (byte) — trimmed
      { role: 'me', text: 'q3' },
      { role: 'byte', text: 'a3' },
    ];
    expect(toClaudeMessages(history, 3)).toEqual([
      { role: 'user', content: 'q3' },
      { role: 'assistant', content: 'a3' },
    ]);
  });

  it('empty turns do not consume the window budget (counts real turns only)', () => {
    const history: ChatTurn[] = [
      { role: 'me', text: 'keep 1' },
      { role: 'byte', text: '   ' }, // dropped before windowing
      { role: 'me', text: 'keep 2' },
    ];
    expect(toClaudeMessages(history, 2)).toEqual([
      { role: 'user', content: 'keep 1' },
      { role: 'user', content: 'keep 2' },
    ]);
  });

  it('defaults to MAX_CHAT_TURNS and leaves shorter histories untouched', () => {
    expect(MAX_CHAT_TURNS).toBeGreaterThan(0);
    const short: ChatTurn[] = [
      { role: 'me', text: 'a' },
      { role: 'byte', text: 'b' },
    ];
    expect(toClaudeMessages(short)).toHaveLength(2);
  });
});
