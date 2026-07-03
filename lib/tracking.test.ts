import { describe, it, expect } from 'vitest';
import {
  aggregateTracking,
  estimateHoursSaved,
  distinctProjects,
  type TrackEvent,
  EMPTY_TRACKING,
} from './tracking';

const ev = (over: Partial<TrackEvent> = {}): TrackEvent => ({
  id: 'e1',
  ts: 1000,
  sessionId: 's1',
  commits: 0,
  prs: 0,
  linesAdded: 0,
  linesRemoved: 0,
  wins: [],
  ...over,
});

describe('estimateHoursSaved', () => {
  it('is 0 when there is no activity', () => {
    expect(estimateHoursSaved({ linesChanged: 0, commits: 0, sessions: 0 })).toBe(0);
  });
  it('scales with lines, commits, and sessions and rounds to a whole number', () => {
    // 300/150 + 5*0.4 + 2*0.3 = 2 + 2 + 0.6 = 4.6 → 5
    expect(estimateHoursSaved({ linesChanged: 300, commits: 5, sessions: 2 })).toBe(5);
  });
});

describe('aggregateTracking', () => {
  it('returns the empty summary for no events', () => {
    expect(aggregateTracking([])).toEqual(EMPTY_TRACKING);
  });

  it('counts sessions and sums code output across events', () => {
    const out = aggregateTracking([
      ev({ commits: 2, prs: 1, linesAdded: 100, linesRemoved: 20 }),
      ev({ id: 'e2', sessionId: 's2', commits: 3, prs: 0, linesAdded: 50, linesRemoved: 30 }),
    ]);
    expect(out.sessions).toBe(2);
    expect(out.commits).toBe(5);
    expect(out.prs).toBe(1);
    expect(out.linesChanged).toBe(200); // 100+20+50+30
  });

  it('surfaces recent wins newest-first, deduped by title, capped at 3', () => {
    const out = aggregateTracking([
      ev({ id: 'a', ts: 10, wins: ['Add login'] }),
      ev({ id: 'b', ts: 30, wins: ['Fix cart', 'Add login'] }), // newer; dup "Add login" drops
      ev({ id: 'c', ts: 20, wins: ['Clean API', 'Tune build'] }),
    ]);
    expect(out.recentWins.map((w) => w.title)).toEqual(['Fix cart', 'Add login', 'Clean API']);
  });

  it('ignores events older than sinceMs when provided', () => {
    const out = aggregateTracking(
      [ev({ id: 'old', ts: 100, commits: 9 }), ev({ id: 'new', ts: 5000, commits: 1 })],
      1000,
    );
    expect(out.sessions).toBe(1);
    expect(out.commits).toBe(1);
  });
});

describe('distinctProjects', () => {
  it('is empty when there are no events', () => {
    expect(distinctProjects([])).toEqual([]);
  });

  it('lists distinct repos newest-first, deduped', () => {
    const out = distinctProjects([
      ev({ id: 'a', ts: 10, repo: 'codepet' }),
      ev({ id: 'b', ts: 30, repo: 'murror' }),
      ev({ id: 'c', ts: 20, repo: 'codepet' }), // dup, older → drops
    ]);
    expect(out).toEqual(['murror', 'codepet']);
  });

  it('falls back to the cwd folder name when repo is absent', () => {
    expect(distinctProjects([ev({ ts: 5, cwd: '/Users/me/Documents/my-app' })])).toEqual([
      'my-app',
    ]);
  });

  it('skips events with neither repo nor cwd', () => {
    expect(distinctProjects([ev({ ts: 5 })])).toEqual([]);
  });

  it('caps the list at the given max', () => {
    const events = Array.from({ length: 5 }, (_, i) => ev({ id: `e${i}`, ts: i, repo: `r${i}` }));
    expect(distinctProjects(events, 2)).toHaveLength(2);
  });
});
