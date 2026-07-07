import type { ThreadMeta } from '@/lib/firebase/schema';

const TITLE_MAX = 40;

/** Title a thread from its first founder message. No model call. */
export function deriveThreadTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return 'New chat';
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX).trimEnd()}…` : clean;
}

/** Newest-first by updatedAt. Does not mutate the input. */
export function sortThreadsByRecent(threads: ThreadMeta[]): ThreadMeta[] {
  return [...threads].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** A company needs the legacy flat chat migrated when it has messages but no threads. */
export function needsBackfill(threadCount: number, messageCount: number): boolean {
  return threadCount === 0 && messageCount > 0;
}

/** After deleting the active thread, which thread should become active (or null → new chat). */
export function pickFallbackThreadId(threads: ThreadMeta[], deletedId: string): string | null {
  const remaining = sortThreadsByRecent(threads.filter((t) => t.id !== deletedId));
  return remaining.length ? remaining[0].id : null;
}

/** Compact relative time for the history list. */
export function relativeTime(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
