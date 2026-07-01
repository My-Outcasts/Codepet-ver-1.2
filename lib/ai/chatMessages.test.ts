import { describe, it, expect } from 'vitest';
import { toClaudeMessages, type ChatTurn } from './chatMessages';

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
});
