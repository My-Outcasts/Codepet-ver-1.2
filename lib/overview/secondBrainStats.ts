// Pure stat helpers for the Second Brain info rail. No side effects — derive the right-rail
// numbers (ledger category counts, per-department topic counts) straight from the event ledger.
import type { LedgerEvent } from '@/lib/firebase/schema';

export function ledgerCounts(events: LedgerEvent[]): {
  deliverables: number;
  decisions: number;
  milestones: number;
  tasks: number;
} {
  let deliverables = 0;
  let decisions = 0;
  let milestones = 0;
  let tasks = 0;
  for (const e of events) {
    if (e.type === 'deliverable_approved') deliverables++;
    else if (e.type === 'decision_made' || e.type === 'fact_remembered') decisions++;
    else if (e.type === 'stage_advanced') milestones++;
    else if (e.type === 'task_run' || e.type === 'build_session') tasks++;
  }
  return { deliverables, decisions, milestones, tasks };
}

export function topicCounts(
  events: LedgerEvent[],
  depts: { k: string; name: string }[],
): Array<{ deptK: string; name: string; count: number }> {
  const byK = new Map<string, number>();
  for (const e of events) if (e.deptK) byK.set(e.deptK, (byK.get(e.deptK) ?? 0) + 1);
  return depts
    .map((d) => ({ deptK: d.k, name: d.name, count: byK.get(d.k) ?? 0 }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count);
}
