import { describe, it, expect } from 'vitest';
import { needsFallbackReply, REFUSAL_FALLBACK } from './chatFallback';

describe('needsFallbackReply', () => {
  it('fires on a refusal stop reason even when text streamed', () => {
    // A mid-stream refusal can leave partial text; byte still needs to own the decline.
    expect(needsFallbackReply({ stopReason: 'refusal', streamedChars: 42, acted: false })).toBe(
      true,
    );
  });

  it('fires when nothing streamed and byte took no action', () => {
    expect(needsFallbackReply({ stopReason: 'end_turn', streamedChars: 0, acted: false })).toBe(
      true,
    );
  });

  it('does NOT fire for a normal reply with streamed text', () => {
    expect(needsFallbackReply({ stopReason: 'end_turn', streamedChars: 120, acted: false })).toBe(
      false,
    );
  });

  it('does NOT fire for an action-only turn (task/nav/setup) with no prose', () => {
    // Running a task with no lead-in text is a real response, not an empty bubble.
    expect(needsFallbackReply({ stopReason: 'tool_use', streamedChars: 0, acted: true })).toBe(
      false,
    );
  });

  it('does NOT fire when byte both acted and spoke', () => {
    expect(needsFallbackReply({ stopReason: 'tool_use', streamedChars: 30, acted: true })).toBe(
      false,
    );
  });

  it('handles a null stop reason (stream ended without one)', () => {
    expect(needsFallbackReply({ stopReason: null, streamedChars: 0, acted: false })).toBe(true);
    expect(needsFallbackReply({ stopReason: null, streamedChars: 5, acted: false })).toBe(false);
  });

  it('exposes an honest, non-empty fallback line', () => {
    expect(REFUSAL_FALLBACK.length).toBeGreaterThan(20);
    expect(REFUSAL_FALLBACK.toLowerCase()).toContain('rephras');
  });
});
