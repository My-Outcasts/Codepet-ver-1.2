import { describe, it, expect } from 'vitest';
import { DEFAULT_DAILY_LIMIT, resolveDailyLimit, dayKey, overDailyLimit } from './rateLimit';

describe('resolveDailyLimit', () => {
  it('uses the default when unset/blank', () => {
    expect(resolveDailyLimit(undefined)).toBe(DEFAULT_DAILY_LIMIT);
    expect(resolveDailyLimit(null)).toBe(DEFAULT_DAILY_LIMIT);
    expect(resolveDailyLimit('')).toBe(DEFAULT_DAILY_LIMIT);
    expect(resolveDailyLimit('   ')).toBe(DEFAULT_DAILY_LIMIT);
  });

  it('parses a positive integer from a string', () => {
    expect(resolveDailyLimit('30')).toBe(30);
    expect(resolveDailyLimit(' 120 ')).toBe(120);
    expect(resolveDailyLimit(45)).toBe(45);
  });

  it('rejects non-positive / non-integer / garbage values (never disables the guard)', () => {
    expect(resolveDailyLimit('0')).toBe(DEFAULT_DAILY_LIMIT);
    expect(resolveDailyLimit('-5')).toBe(DEFAULT_DAILY_LIMIT);
    expect(resolveDailyLimit('12.5')).toBe(DEFAULT_DAILY_LIMIT);
    expect(resolveDailyLimit('abc')).toBe(DEFAULT_DAILY_LIMIT);
    expect(resolveDailyLimit(NaN)).toBe(DEFAULT_DAILY_LIMIT);
    expect(resolveDailyLimit(Infinity)).toBe(DEFAULT_DAILY_LIMIT);
  });
});

describe('dayKey', () => {
  it('is the UTC YYYY-MM-DD bucket', () => {
    expect(dayKey(new Date('2026-07-01T00:00:00Z'))).toBe('2026-07-01');
    expect(dayKey(new Date('2026-07-01T23:59:59Z'))).toBe('2026-07-01');
    // Just past UTC midnight rolls to the next bucket.
    expect(dayKey(new Date('2026-07-02T00:00:01Z'))).toBe('2026-07-02');
  });
});

describe('overDailyLimit', () => {
  it('allows exactly `cap` generations, then trips', () => {
    expect(overDailyLimit(1, 30)).toBe(false);
    expect(overDailyLimit(30, 30)).toBe(false); // 30th is allowed
    expect(overDailyLimit(31, 30)).toBe(true); // 31st is over
    expect(overDailyLimit(200, 30)).toBe(true);
  });
});
