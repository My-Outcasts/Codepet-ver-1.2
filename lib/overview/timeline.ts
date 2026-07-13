// Pure helpers for the Second Brain timeline ("what changed"). No side effects — takes `now`
// as an argument so relativeTime is deterministic and unit-testable.
import type { LedgerEvent, LedgerEventType } from '@/lib/firebase/schema';

export type TimelineFilter = 'all' | 'deliverable' | 'decision' | 'milestone' | 'task';

const FILTER_TYPES: Record<Exclude<TimelineFilter, 'all'>, LedgerEventType[]> = {
  deliverable: ['deliverable_approved'],
  decision: ['decision_made', 'fact_remembered'],
  milestone: ['stage_advanced'],
  task: ['task_run', 'build_session', 'toolkit_used'],
};

/** Events matching the filter, newest-first. */
export function filterEvents(events: LedgerEvent[], filter: TimelineFilter): LedgerEvent[] {
  const sorted = [...events].sort((a, b) => b.ts - a.ts);
  if (filter === 'all') return sorted;
  const types = new Set<LedgerEventType>(FILTER_TYPES[filter]);
  return sorted.filter((e) => types.has(e.type));
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "just now" / "5m ago" / "3h ago" / "2d ago" / "Jul 2" for older-than-a-week. */
export function relativeTime(ts: number, now: number): string {
  const d = now - ts;
  if (d < MIN) return 'just now';
  if (d < HOUR) return `${Math.floor(d / MIN)}m ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h ago`;
  if (d < 7 * DAY) return `${Math.floor(d / DAY)}d ago`;
  const date = new Date(ts);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}
