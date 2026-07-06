import { describe, it, expect, afterEach } from 'vitest';
import { PHASES } from '../data';
import { setStageWatermark, stageWatermark } from '../roadmap';
import { ribbonSegments } from './ribbon';

describe('ribbonSegments', () => {
  const restore = stageWatermark();
  afterEach(() => setStageWatermark(restore));

  it('returns one segment per phase, in order', () => {
    const segs = ribbonSegments();
    expect(segs.map((s) => s.name)).toEqual(PHASES.map((p) => p.name));
  });

  it('marks exactly one phase current for a mid-journey watermark (stage 6)', () => {
    setStageWatermark(6);
    const segs = ribbonSegments();
    expect(segs.filter((s) => s.state === 'current')).toHaveLength(1);
    const cur = segs.find((s) => s.state === 'current')!;
    expect(cur.stageN).toBe(6); // opens the "now" stage
  });

  it('phases fully before the watermark are done, fully after are future', () => {
    setStageWatermark(6);
    const segs = ribbonSegments();
    expect(segs[0].state).toBe('done'); // Find (stage 1) is behind us
    expect(segs[0].stageN).toBe(1); // a non-current segment opens its first stage
    expect(segs[segs.length - 1].state).toBe('future');
  });

  it('everything is done when the watermark is past the last stage', () => {
    setStageWatermark(999);
    const segs = ribbonSegments();
    expect(segs.every((s) => s.state === 'done')).toBe(true);
    expect(segs.some((s) => s.state === 'current')).toBe(false);
  });

  it('first phase is current at the very start (watermark 1)', () => {
    setStageWatermark(1);
    const segs = ribbonSegments();
    expect(segs[0].state).toBe('current');
    expect(segs.slice(1).every((s) => s.state === 'future')).toBe(true);
  });
});
