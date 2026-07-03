'use client';
// Client side of byte's "single next step" pick. Builds the catalog of open tasks
// from the live DEPTS state and asks /api/next-step (which holds the Anthropic key)
// which ONE to do next. The result is cached in the store and read by BOTH the
// Overview beacon and byte's chat, so the two can never disagree about what's next.
import { DEPTS } from '../data';
import { authHeader } from './runTask';

export interface NextStep {
  deptK: string;
  taskTitle: string;
  why: string;
}

export interface NextStepTask {
  deptK: string;
  deptName: string;
  need: string;
  title: string;
  desc: string;
  who: string;
}

/** Every not-done task across the departments, in a stable order. */
export function openTaskCatalog(): NextStepTask[] {
  const items: NextStepTask[] = [];
  for (const d of DEPTS) {
    for (const t of d.tasks) {
      if (t.done) continue;
      items.push({
        deptK: d.k,
        deptName: d.name,
        need: d.need || '',
        title: t.t,
        desc: t.d || '',
        who: t.who || '',
      });
    }
  }
  return items;
}

/**
 * Ask byte which single task to do next. Returns the resolved pick, or null when
 * there's nothing open. Throws on transport/API failure so the caller can fall
 * back to the authored golden path (keeping the beacon and chat in agreement).
 */
export async function fetchNextStep(): Promise<NextStep | null> {
  const catalog = openTaskCatalog();
  if (catalog.length === 0) return null;
  const res = await fetch('/api/next-step', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ tasks: catalog }),
  });
  if (!res.ok) throw new Error(`next-step http_${res.status}`);
  const data = (await res.json()) as { pick?: number; why?: string };
  const c = typeof data.pick === 'number' ? catalog[data.pick] : undefined;
  if (!c) return null;
  return { deptK: c.deptK, taskTitle: c.title, why: typeof data.why === 'string' ? data.why : '' };
}
