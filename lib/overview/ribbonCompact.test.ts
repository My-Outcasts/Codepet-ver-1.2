import { describe, it, expect } from 'vitest';
import { compactRibbon } from './ribbonCompact';
import type { RibbonSegment } from './ribbon';

const seg = (name: string, state: RibbonSegment['state'], stageN: number): RibbonSegment => ({
  name,
  state,
  stageN,
});

describe('compactRibbon', () => {
  it('mid-journey: partitions lead-done / current / trail-ahead', () => {
    const segs = [
      seg('Find', 'done', 1),
      seg('Build', 'done', 2),
      seg('Ship', 'done', 4),
      seg('Launch', 'current', 5),
      seg('Run & grow', 'future', 7),
    ];
    const c = compactRibbon(segs);
    expect(c.leadDone).toEqual({ count: 3, stageN: 1 });
    expect(c.current).toEqual(seg('Launch', 'current', 5));
    expect(c.trailAhead).toEqual({ count: 1, stageN: 7 });
  });

  it('current first: no leadDone', () => {
    const segs = [seg('Find', 'current', 1), seg('Build', 'future', 2), seg('Ship', 'future', 4)];
    const c = compactRibbon(segs);
    expect(c.leadDone).toBeNull();
    expect(c.current?.name).toBe('Find');
    expect(c.trailAhead).toEqual({ count: 2, stageN: 2 });
  });

  it('current last: no trailAhead', () => {
    const segs = [seg('Find', 'done', 1), seg('Build', 'done', 2), seg('Ship', 'current', 4)];
    const c = compactRibbon(segs);
    expect(c.leadDone).toEqual({ count: 2, stageN: 1 });
    expect(c.current?.name).toBe('Ship');
    expect(c.trailAhead).toBeNull();
  });

  it('all done: no current, leadDone covers all, no trailAhead', () => {
    const segs = [seg('Find', 'done', 1), seg('Build', 'done', 2), seg('Ship', 'done', 4)];
    const c = compactRibbon(segs);
    expect(c.current).toBeNull();
    expect(c.leadDone).toEqual({ count: 3, stageN: 1 });
    expect(c.trailAhead).toBeNull();
  });

  it('group stageN is the first constituent phase; deterministic', () => {
    const segs = [seg('Find', 'done', 1), seg('Build', 'done', 2), seg('Ship', 'current', 4)];
    expect(compactRibbon(segs)).toEqual(compactRibbon(segs));
    expect(compactRibbon(segs).leadDone?.stageN).toBe(1);
  });
});
