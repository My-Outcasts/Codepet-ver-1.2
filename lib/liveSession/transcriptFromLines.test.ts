import { describe, it, expect } from 'vitest';
import { applyLine } from './useLiveSession';
import { initialTranscript } from './transcript';

describe('applyLine', () => {
  it('folds a raw ndjson line (possibly yielding several events) into the transcript', () => {
    let s = initialTranscript();
    s = applyLine(s, JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }));
    s = applyLine(
      s,
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'hi' },
            { type: 'tool_use', id: 't1', name: 'Read', input: {} },
          ],
        },
      }),
    );
    expect(s.sessionId).toBe('s1');
    expect(s.messages).toEqual([{ role: 'assistant', text: 'hi' }]);
    expect(s.tools.map((t) => t.name)).toEqual(['Read']);
    expect(s.actionCount).toBe(1);
  });

  it('ignores a blank or malformed line', () => {
    const s0 = initialTranscript();
    expect(applyLine(s0, '')).toBe(s0);
    expect(applyLine(s0, '{bad')).toBe(s0);
  });
});
