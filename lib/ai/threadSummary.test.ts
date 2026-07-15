import { describe, it, expect } from 'vitest';
import {
  planThreadSummary,
  formatThreadSummaryBlock,
  buildSummaryPrompt,
  SUMMARY_BATCH,
} from './threadSummary';
import type { ChatTurn } from './chatMessages';

const turns = (n: number): ChatTurn[] =>
  Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? 'me' : 'byte', text: `t${i}` }));

describe('planThreadSummary', () => {
  const window = 20;

  it('does nothing while the thread fits in the window', () => {
    expect(planThreadSummary(turns(20), 0, window)).toEqual({ turns: [], through: 0 });
    expect(planThreadSummary(turns(5), 0, window)).toEqual({ turns: [], through: 0 });
  });

  it('waits until at least `batch` turns have dropped before summarizing', () => {
    // 20 + (batch-1) dropped → still below the batch threshold, so skip.
    const justUnder = window + SUMMARY_BATCH - 1;
    expect(planThreadSummary(turns(justUnder), 0, window).turns).toEqual([]);
  });

  it('summarizes the dropped prefix once the batch threshold is met', () => {
    const total = window + SUMMARY_BATCH; // exactly `batch` turns have dropped
    const plan = planThreadSummary(turns(total), 0, window);
    expect(plan.through).toBe(SUMMARY_BATCH); // droppedCount = total - window
    expect(plan.turns.map((t) => t.text)).toEqual(
      Array.from({ length: SUMMARY_BATCH }, (_, i) => `t${i}`),
    );
  });

  it('is incremental — only folds turns past the high-water mark', () => {
    const total = window + SUMMARY_BATCH * 2; // 16 dropped, 8 already summarized
    const plan = planThreadSummary(turns(total), SUMMARY_BATCH, window);
    expect(plan.through).toBe(SUMMARY_BATCH * 2);
    expect(plan.turns.map((t) => t.text)).toEqual(
      Array.from({ length: SUMMARY_BATCH }, (_, i) => `t${SUMMARY_BATCH + i}`),
    );
  });

  it('skips when the newly-dropped count since last summary is below batch', () => {
    const total = window + SUMMARY_BATCH + 2; // 10 dropped, 8 summarized → 2 pending
    expect(planThreadSummary(turns(total), SUMMARY_BATCH, window).turns).toEqual([]);
  });

  it('tolerates a garbage / oversized summarizedThrough without going negative', () => {
    const plan = planThreadSummary(turns(30), 999, window);
    expect(plan.turns).toEqual([]);
    expect(plan.through).toBe(999);
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
