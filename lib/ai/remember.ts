'use client';
// Client side of the decisions writer. After the founder approves a deliverable, tell
// byte to extract any durable decision from it (server-side, /api/remember). Strictly
// fire-and-forget and best-effort: it never blocks the approval, never surfaces errors,
// and is inert unless the server has AI_MEMORY_ENABLED set.
import { authHeader } from './runTask';

export interface RememberInput {
  title: string;
  dept: string;
  type: string;
  out: string;
}

/** Fire the extraction request and forget it. Swallows every error. */
export function rememberApproval(item: RememberInput): void {
  if (!item.title || !item.out) return; // nothing to extract from
  void (async () => {
    try {
      await fetch('/api/remember', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ deliverable: item }),
      });
    } catch {
      /* best-effort — the approval already succeeded */
    }
  })();
}
