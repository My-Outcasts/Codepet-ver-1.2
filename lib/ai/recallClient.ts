'use client';
// Client helper for "Ask your Second Brain": POST the question to the recall route with the
// founder's auth token and return the cited hits. Best-effort — a disabled feature (no key/flag)
// or any error yields an empty list, so the UI simply shows its quiet empty state.
import { authHeader } from './runTask';

export interface RecallHit {
  refType?: string;
  refId?: string;
  title: string;
  summary: string;
  score: number;
}

/** One-time backfill: project existing deliverables + decisions into the event ledger so the
 *  map shows history immediately. Idempotent server-side. Returns how many events were written. */
export async function runSecondBrainBackfill(): Promise<{ backfilled: number; skipped: boolean }> {
  try {
    const res = await fetch('/api/second-brain/backfill', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader()) },
    });
    if (!res.ok) return { backfilled: 0, skipped: false };
    return (await res.json()) as { backfilled: number; skipped: boolean };
  } catch {
    return { backfilled: 0, skipped: false };
  }
}

export async function askSecondBrain(query: string): Promise<RecallHit[]> {
  try {
    const res = await fetch('/api/second-brain/recall', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { enabled?: boolean; hits?: RecallHit[] };
    return json.hits ?? [];
  } catch {
    return [];
  }
}
