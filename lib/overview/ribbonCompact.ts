// Collapses the stage ribbon for narrow widths: everything before the current
// phase becomes a single "N done" group, everything after a single "N ahead"
// group, the current phase stays whole. Pure partition of ribbonSegments()'s
// output (journey order, at most one 'current'); node-env unit-testable.
import type { RibbonSegment } from './ribbon';

export interface CompactGroup {
  count: number;
  /** Stage to open when the group chip is clicked: the group's first phase. */
  stageN: number;
}

export interface CompactRibbon {
  /** Done phases before the current one, or null if none. */
  leadDone: CompactGroup | null;
  /** The single 'current' phase, or null if the journey is complete. */
  current: RibbonSegment | null;
  /** Future phases after the current one, or null if none. */
  trailAhead: CompactGroup | null;
}

const group = (items: RibbonSegment[]): CompactGroup | null =>
  items.length ? { count: items.length, stageN: items[0].stageN } : null;

export function compactRibbon(segs: RibbonSegment[]): CompactRibbon {
  const i = segs.findIndex((s) => s.state === 'current');
  if (i === -1) {
    // No current phase (journey complete): all remaining are "done" leaders.
    return { leadDone: group(segs), current: null, trailAhead: null };
  }
  return {
    leadDone: group(segs.slice(0, i)),
    current: segs[i],
    trailAhead: group(segs.slice(i + 1)),
  };
}
