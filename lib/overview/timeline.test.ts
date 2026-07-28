import { describe, it, expect } from 'vitest';
import { filterEvents, relativeTime, type TimelineFilter } from './timeline';
import type { LedgerEvent } from '@/lib/firebase/schema';

const ev = (ts: number, type: LedgerEvent['type']): LedgerEvent => ({
  ts,
  type,
  actor: 'byte',
  title: type,
  summary: type,
});

const events: LedgerEvent[] = [
  ev(1, 'task_run'),
  ev(3, 'deliverable_approved'),
  ev(2, 'decision_made'),
  ev(4, 'stage_advanced'),
];

describe('filterEvents', () => {
  it('sorts newest-first for "all"', () => {
    expect(filterEvents(events, 'all').map((e) => e.ts)).toEqual([4, 3, 2, 1]);
  });
  it('maps each filter to its event types', () => {
    const cases: [TimelineFilter, string][] = [
      ['deliverable', 'deliverable_approved'],
      ['decision', 'decision_made'],
      ['milestone', 'stage_advanced'],
      ['task', 'task_run'],
    ];
    for (const [filter, type] of cases) {
      const out = filterEvents(events, filter);
      expect(out).toHaveLength(1);
      expect(out[0].type).toBe(type);
    }
  });
});

describe('relativeTime', () => {
  const NOW = 1_000_000_000_000;
  it('buckets by recency', () => {
    expect(relativeTime(NOW - 10_000, NOW)).toBe('just now');
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe('5m ago');
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe('3h ago');
    expect(relativeTime(NOW - 2 * 86_400_000, NOW)).toBe('2d ago');
  });
  it('falls back to an absolute date past a week', () => {
    const out = relativeTime(NOW - 30 * 86_400_000, NOW);
    expect(out).toMatch(/^[A-Z][a-z]{2} \d+$/);
  });
});
