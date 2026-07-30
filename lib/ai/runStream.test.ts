import { describe, it, expect } from 'vitest';
import { encodeEvent, createEventDecoder } from './runStream';
import type { RunEvent } from './runTrace';

const ev: RunEvent = { type: 'active', phase: 'generate' };

describe('encodeEvent', () => {
  it('writes one newline-terminated JSON object', () => {
    expect(encodeEvent(ev)).toBe('{"type":"active","phase":"generate"}\n');
  });
});

describe('createEventDecoder', () => {
  it('decodes whole lines', () => {
    const decode = createEventDecoder();
    expect(decode(encodeEvent(ev) + encodeEvent(ev))).toEqual([ev, ev]);
  });

  it('holds a partial line until its newline arrives', () => {
    const decode = createEventDecoder();
    const wire = encodeEvent(ev);
    const cut = wire.slice(0, 12);
    expect(decode(cut)).toEqual([]);
    expect(decode(wire.slice(12))).toEqual([ev]);
  });

  it('splits a chunk that carries one and a half events', () => {
    const decode = createEventDecoder();
    const wire = encodeEvent(ev);
    expect(decode(wire + wire.slice(0, 9))).toEqual([ev]);
    expect(decode(wire.slice(9))).toEqual([ev]);
  });

  it('skips a malformed line instead of throwing', () => {
    const decode = createEventDecoder();
    expect(decode('not json\n' + encodeEvent(ev))).toEqual([ev]);
  });

  it('ignores blank lines', () => {
    const decode = createEventDecoder();
    expect(decode('\n\n' + encodeEvent(ev))).toEqual([ev]);
  });
});
