import { describe, it, expect } from 'vitest';
import {
  planThreadSummary,
  formatThreadSummaryBlock,
  buildSummaryPrompt,
  SUMMARY_BATCH,
  type TurnRef,
} from './threadSummary';

// Build turns with ascending timestamps ts=from..to (inclusive). ts doubles as the marker.
const tsTurns = (from: number, to: number): TurnRef[] =>
  Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => {
    const ts = from + i;
    return { role: ts % 2 === 0 ? 'me' : 'byte', text: `t${ts}`, ts };
  });

describe('planThreadSummary', () => {
  const window = 20;

  it('does nothing while the thread fits in the window', () => {
    expect(planThreadSummary(tsTurns(1, 20), 0, window).turns).toEqual([]);
    expect(planThreadSummary(tsTurns(1, 5), 0, window).turns).toEqual([]);
  });

  it('waits until at least `batch` turns have dropped before summarizing', () => {
    // 20 + (batch-1) dropped → still below the batch threshold, so skip.
    const justUnder = tsTurns(1, window + SUMMARY_BATCH - 1);
    expect(planThreadSummary(justUnder, 0, window).turns).toEqual([]);
  });

  it('summarizes the dropped prefix once the batch threshold is met', () => {
    const total = tsTurns(1, window + SUMMARY_BATCH); // exactly `batch` turns dropped (ts 1..8)
    const plan = planThreadSummary(total, 0, window);
    expect(plan.turns.map((t) => t.text)).toEqual(
      Array.from({ length: SUMMARY_BATCH }, (_, i) => `t${i + 1}`),
    );
    expect(plan.throughTs).toBe(SUMMARY_BATCH); // newest folded ts
  });

  it('is incremental — only folds turns newer than the marker ts', () => {
    const total = tsTurns(1, window + SUMMARY_BATCH * 2); // 16 dropped (ts 1..16)
    const plan = planThreadSummary(total, SUMMARY_BATCH, window); // already folded through ts 8
    expect(plan.turns.map((t) => t.text)).toEqual(
      Array.from({ length: SUMMARY_BATCH }, (_, i) => `t${SUMMARY_BATCH + 1 + i}`), // ts 9..16
    );
    expect(plan.throughTs).toBe(SUMMARY_BATCH * 2);
  });

  it('skips when the count of turns newer than the marker is below batch', () => {
    const total = tsTurns(1, window + SUMMARY_BATCH + 2); // 10 dropped, folded through ts 8 → 2 pending
    expect(planThreadSummary(total, SUMMARY_BATCH, window).turns).toEqual([]);
  });

  it('keeps summarizing after a reload truncates history (GAP-2 regression)', () => {
    // Before reload we folded through the turn at ts=130. On reload only the last ~100 turns
    // hydrate (CHAT_LOAD_LIMIT), then 8 new turns arrive. A COUNT-based marker (130) would go
    // permanently negative vs the truncated length and never summarize again; the ts marker
    // must still fold the 8 new dropped turns.
    const reloaded = tsTurns(51, 158); // 108 turns in memory, ts 51..158
    const plan = planThreadSummary(reloaded, 130, window);
    // dropped = ts 51..138 (108-20); pending = ts 131..138 (newer than marker) = 8 → fold.
    expect(plan.turns.map((t) => t.text)).toEqual(
      Array.from({ length: 8 }, (_, i) => `t${131 + i}`),
    );
    expect(plan.throughTs).toBe(138);
  });

  it('folds nothing when the marker is already at/after the newest dropped turn', () => {
    const plan = planThreadSummary(tsTurns(1, 30), 999, window);
    expect(plan.turns).toEqual([]);
    expect(plan.throughTs).toBe(999);
  });
});

describe('formatThreadSummaryBlock', () => {
  it('returns an injectable block when a summary exists', () => {
    const block = formatThreadSummaryBlock('the founder wants a dark theme');
    expect(block).toContain('Earlier in this conversation');
    expect(block).toContain('dark theme');
  });

  it('is empty for missing / blank summaries', () => {
    expect(formatThreadSummaryBlock('')).toBe('');
    expect(formatThreadSummaryBlock('   ')).toBe('');
    expect(formatThreadSummaryBlock(undefined)).toBe('');
    expect(formatThreadSummaryBlock(null)).toBe('');
  });
});

describe('buildSummaryPrompt', () => {
  it('includes the prior summary and the new turns, labelled by role', () => {
    const p = buildSummaryPrompt('founder wants dark mode', [
      { role: 'me', text: 'also add SSO' },
      { role: 'byte', text: 'got it' },
    ]);
    expect(p).toContain('founder wants dark mode');
    expect(p).toContain('Founder: also add SSO');
    expect(p).toContain('byte: got it');
  });

  it('handles an empty prior summary (first fold)', () => {
    const p = buildSummaryPrompt('', [{ role: 'me', text: 'build a todo app' }]);
    expect(p).toContain('no summary yet');
    expect(p).toContain('Founder: build a todo app');
  });
});
