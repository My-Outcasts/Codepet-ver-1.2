// Pure builders that turn Codepet's existing source records into ledger events.
// No side effects, no Firestore — just shape mapping, so they're trivially testable
// and shared by both the write-through emits (store) and the one-time backfill route.
import type { LedgerEvent } from '@/lib/firebase/schema';
import type { Task } from '@/lib/data';
import type { DecisionEntry } from '@/lib/ai/projectModel';

/** Deterministic, Firestore-safe doc id so backfill re-runs overwrite instead of duplicate. */
export function eventKey(refType: string, refId: string): string {
  return `${refType}_${refId}`.replace(/[^a-zA-Z0-9_-]/g, '-');
}

/** Raw library doc as stored (in-app LibItem strips id/createdAt; backfill reads the doc). */
export interface LibDocLike {
  id: string;
  title?: string;
  k?: string;
  createdAt?: number;
}

export function eventFromLibItem(item: LibDocLike, deptK?: string): LedgerEvent {
  const title = item.title ?? 'Deliverable';
  return {
    ts: item.createdAt ?? 0,
    type: 'deliverable_approved',
    actor: 'byte',
    deptK: deptK ?? item.k,
    refType: 'library',
    refId: item.id,
    title,
    summary: `Approved deliverable: ${title}.`,
  };
}

export function eventFromDecision(d: DecisionEntry, index: number): LedgerEvent {
  const statement = d.statement ?? d.topic ?? 'Decision';
  return {
    ts: d.updatedAt ?? 0,
    type: 'decision_made',
    actor: 'byte',
    refType: 'decision',
    refId: String(index),
    title: (d.topic ?? statement).slice(0, 80),
    summary: `Decision${d.topic ? ` on ${d.topic}` : ''}: ${statement}`,
  };
}

export function eventFromTaskDone(
  deptK: string,
  deptName: string,
  task: Task,
  ts: number,
): LedgerEvent {
  return {
    ts,
    type: 'task_run',
    actor: 'founder',
    deptK,
    refType: 'task',
    refId: `${deptK}:${task.t}`,
    title: task.t,
    summary: `Completed "${task.t}" in ${deptName}.`,
  };
}

export function eventFromStageAdvance(stage: number, stageName: string, ts: number): LedgerEvent {
  return {
    ts,
    type: 'stage_advanced',
    actor: 'founder',
    refType: 'stage',
    refId: String(stage),
    title: `Advanced to ${stageName}`,
    summary: `Company advanced to stage: ${stageName}.`,
  };
}
