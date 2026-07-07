import { describe, it, expect } from 'vitest';
import {
  deriveThreadTitle,
  sortThreadsByRecent,
  needsBackfill,
  pickFallbackThreadId,
  relativeTime,
} from './threads';
import type { ThreadMeta } from '@/lib/firebase/schema';

const t = (id: string, updatedAt: number): ThreadMeta => ({
  id,
  title: id,
  createdAt: updatedAt,
  updatedAt,
});

describe('deriveThreadTitle', () => {
  it('uses the message, collapsing whitespace', () => {
    expect(deriveThreadTitle('  Help me   draft copy ')).toBe('Help me draft copy');
  });
  it('truncates to 40 chars with an ellipsis', () => {
    const long = 'Draft the landing page hero copy for the new pricing tiers';
    expect(deriveThreadTitle(long)).toBe('Draft the landing page hero copy for the…');
  });
  it('falls back to "New chat" for empty/whitespace', () => {
    expect(deriveThreadTitle('   ')).toBe('New chat');
    expect(deriveThreadTitle('')).toBe('New chat');
  });
  it('keeps a 40-char input unchanged but truncates 41 chars', () => {
    expect(deriveThreadTitle('a'.repeat(40))).toBe('a'.repeat(40));
    expect(deriveThreadTitle('a'.repeat(41))).toBe(`${'a'.repeat(40)}…`);
  });
});

describe('sortThreadsByRecent', () => {
  it('sorts by updatedAt descending without mutating input', () => {
    const input = [t('a', 1), t('b', 3), t('c', 2)];
    expect(sortThreadsByRecent(input).map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(input.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('needsBackfill', () => {
  it('is true only when no threads but messages exist', () => {
    expect(needsBackfill(0, 5)).toBe(true);
    expect(needsBackfill(1, 5)).toBe(false);
    expect(needsBackfill(0, 0)).toBe(false);
  });
});

describe('pickFallbackThreadId', () => {
  it('returns the most-recent remaining thread', () => {
    expect(pickFallbackThreadId([t('a', 1), t('b', 3), t('c', 2)], 'b')).toBe('c');
  });
  it('returns null when nothing remains', () => {
    expect(pickFallbackThreadId([t('a', 1)], 'a')).toBeNull();
  });
});

describe('relativeTime', () => {
  const now = 1_000_000_000_000;
  it('formats recent times', () => {
    expect(relativeTime(now, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2d ago');
  });
  it('handles tier boundaries exactly', () => {
    expect(relativeTime(now - 59 * 1000, now)).toBe('just now');
    expect(relativeTime(now - 60 * 1000, now)).toBe('1m ago');
    expect(relativeTime(now - 59 * 60_000, now)).toBe('59m ago');
    expect(relativeTime(now - 60 * 60_000, now)).toBe('1h ago');
    expect(relativeTime(now - 23 * 3_600_000, now)).toBe('23h ago');
    expect(relativeTime(now - 24 * 3_600_000, now)).toBe('1d ago');
  });
});
