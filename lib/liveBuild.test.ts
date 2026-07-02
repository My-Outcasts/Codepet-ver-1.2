import { describe, it, expect } from 'vitest';
import {
  reduceLive,
  initialLive,
  eventKindFor,
  sanitizeLiveEvent,
  RECENT_TOOLS_CAP,
} from './liveBuild';

const base = { buildSessionId: 'b1', sessionId: 's1' };

describe('reduceLive', () => {
  it('start resets state', () => {
    const prev = {
      sessionId: 's1',
      actionCount: 9,
      turns: 3,
      recentTools: ['Edit'],
      startedAt: 1,
      lastTs: 5,
      ended: true,
    };
    const s = reduceLive(prev, { ...base, kind: 'start', ts: 100 });
    expect(s).toEqual({
      sessionId: 's1',
      actionCount: 0,
      turns: 0,
      recentTools: [],
      startedAt: 100,
      lastTs: 100,
      ended: false,
    });
  });

  it('start from null initialises and records the session id', () => {
    const s = reduceLive(null, { ...base, kind: 'start', ts: 50 });
    expect(s.actionCount).toBe(0);
    expect(s.startedAt).toBe(50);
    expect(s.sessionId).toBe('s1');
  });

  it('tool increments actionCount and records the tool', () => {
    const s0 = initialLive(10);
    const s1 = reduceLive(s0, { ...base, kind: 'tool', tool: 'Edit', ts: 20 });
    expect(s1.actionCount).toBe(1);
    expect(s1.recentTools).toEqual(['Edit']);
    expect(s1.lastTs).toBe(20);
  });

  it('caps recentTools to the last RECENT_TOOLS_CAP', () => {
    let s = initialLive(0);
    for (let i = 0; i < RECENT_TOOLS_CAP + 3; i++)
      s = reduceLive(s, { ...base, kind: 'tool', tool: `T${i}`, ts: i });
    expect(s.recentTools).toHaveLength(RECENT_TOOLS_CAP);
    expect(s.recentTools[RECENT_TOOLS_CAP - 1]).toBe(`T${RECENT_TOOLS_CAP + 2}`);
    expect(s.actionCount).toBe(RECENT_TOOLS_CAP + 3);
  });

  it('turn increments turns only', () => {
    const s = reduceLive(initialLive(0), { ...base, kind: 'turn', ts: 7 });
    expect(s.turns).toBe(1);
    expect(s.actionCount).toBe(0);
    expect(s.lastTs).toBe(7);
  });

  it('tool event with no tool name still counts the action', () => {
    const s = reduceLive(initialLive(0), { ...base, kind: 'tool', ts: 3 });
    expect(s.actionCount).toBe(1);
    expect(s.recentTools).toEqual([]);
  });
});

describe('eventKindFor', () => {
  it('maps hook event names to live kinds', () => {
    expect(eventKindFor('SessionStart')).toBe('start');
    expect(eventKindFor('PostToolUse')).toBe('tool');
    expect(eventKindFor('Stop')).toBe('turn');
    expect(eventKindFor('SessionEnd')).toBeNull();
    expect(eventKindFor('whatever')).toBeNull();
  });
});

describe('sanitizeLiveEvent', () => {
  it('accepts a well-formed tool event', () => {
    const e = sanitizeLiveEvent({ buildSessionId: 'b', sessionId: 's', kind: 'tool', tool: 'Edit' });
    expect(e).toMatchObject({ buildSessionId: 'b', sessionId: 's', kind: 'tool', tool: 'Edit' });
    expect(typeof e?.ts).toBe('number');
  });

  it('rejects unknown kinds and missing ids', () => {
    expect(sanitizeLiveEvent({ buildSessionId: 'b', sessionId: 's', kind: 'nope' })).toBeNull();
    expect(sanitizeLiveEvent({ sessionId: 's', kind: 'tool' })).toBeNull();
    expect(sanitizeLiveEvent(null)).toBeNull();
  });

  it('drops tool for non-tool kinds', () => {
    const e = sanitizeLiveEvent({ buildSessionId: 'b', sessionId: 's', kind: 'turn', tool: 'X' });
    expect(e?.tool).toBeUndefined();
  });
});
