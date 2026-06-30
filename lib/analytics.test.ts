import { describe, it, expect, afterEach } from 'vitest';
import { track, setAnalyticsSink, type AnalyticsEvent } from './analytics';

afterEach(() => {
  // restore a quiet sink between tests
  setAnalyticsSink(() => {});
});

describe('analytics façade', () => {
  it('routes events to the active sink with name, props, and a timestamp', () => {
    const seen: AnalyticsEvent[] = [];
    setAnalyticsSink((e) => seen.push(e));
    track('task.run', { dept: 'eng', live: true });
    expect(seen).toHaveLength(1);
    expect(seen[0].name).toBe('task.run');
    expect(seen[0].props).toEqual({ dept: 'eng', live: true });
    expect(typeof seen[0].ts).toBe('number');
  });

  it('swapping the sink redirects subsequent events', () => {
    const a: string[] = [];
    const b: string[] = [];
    setAnalyticsSink((e) => a.push(e.name));
    track('one');
    setAnalyticsSink((e) => b.push(e.name));
    track('two');
    expect(a).toEqual(['one']);
    expect(b).toEqual(['two']);
  });

  it('a throwing sink never propagates to the caller', () => {
    setAnalyticsSink(() => {
      throw new Error('sink boom');
    });
    expect(() => track('safe')).not.toThrow();
  });
});
