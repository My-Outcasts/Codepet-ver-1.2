import { describe, it, expect } from 'vitest';
import { liveFromTranscript, ASK_PERMISSION, ASK_REPLY } from './liveFromTranscript';
import { initialTranscript, type TranscriptState } from './transcript';
import { RECENT_TOOLS_CAP } from '../liveBuild';

const at = (over: Partial<TranscriptState>): TranscriptState => ({
  ...initialTranscript(),
  ...over,
});

describe('liveFromTranscript', () => {
  it('maps an empty transcript to zeroed live state', () => {
    const live = liveFromTranscript(initialTranscript(), 100, 200);
    expect(live).toMatchObject({
      sessionId: '',
      actionCount: 0,
      turns: 0,
      recentTools: [],
      startedAt: 100,
      lastTs: 200,
      ended: false,
    });
    expect(live.lastSay).toBeUndefined();
    expect(live.pendingAsk).toBeUndefined();
  });

  it('counts actions and keeps only the most recent tools as friendly verbs', () => {
    const tools = Array.from({ length: RECENT_TOOLS_CAP + 3 }, (_, i) => ({
      id: `t${i}`,
      name: i === RECENT_TOOLS_CAP + 2 ? 'Bash' : 'UnknownTool',
      input: {},
    }));
    const live = liveFromTranscript(at({ tools, actionCount: tools.length }), 0, 0);
    expect(live.actionCount).toBe(RECENT_TOOLS_CAP + 3);
    expect(live.recentTools).toHaveLength(RECENT_TOOLS_CAP);
    // Unknown tools fall back to their raw name; known ones get the friendly verb.
    expect(live.recentTools.at(-1)).not.toBe('Bash');
  });

  it('surfaces the last assistant message as lastSay, trimmed to 160 chars', () => {
    const live = liveFromTranscript(
      at({
        messages: [
          { role: 'assistant', text: 'first' },
          { role: 'user', text: 'me' },
          { role: 'assistant', text: `  ${'x'.repeat(200)}  ` },
        ],
      }),
      0,
      0,
    );
    expect(live.lastSay).toHaveLength(160);
    expect(live.turns).toBe(2);
  });

  it('sets pendingAsk for the two blocked states and clears it otherwise', () => {
    expect(liveFromTranscript(at({ status: 'awaiting-permission' }), 0, 0).pendingAsk).toBe(
      ASK_PERMISSION,
    );
    expect(liveFromTranscript(at({ status: 'awaiting-input' }), 0, 0).pendingAsk).toBe(ASK_REPLY);
    expect(liveFromTranscript(at({ status: 'running' }), 0, 0).pendingAsk).toBeUndefined();
  });

  it('marks ended for both ended and error statuses', () => {
    expect(liveFromTranscript(at({ status: 'ended' }), 0, 0).ended).toBe(true);
    expect(liveFromTranscript(at({ status: 'error' }), 0, 0).ended).toBe(true);
    expect(liveFromTranscript(at({ status: 'running' }), 0, 0).ended).toBe(false);
  });

  it('carries the claude session id through', () => {
    expect(liveFromTranscript(at({ sessionId: 'sess-1' }), 0, 0).sessionId).toBe('sess-1');
  });

  it('carries the summed token count through', () => {
    expect(liveFromTranscript(at({ tokens: 42 }), 0, 0).tokens).toBe(42);
  });
});
