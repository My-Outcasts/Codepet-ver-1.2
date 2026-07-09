import { describe, it, expect } from 'vitest';
import { ledgerCounts, topicCounts } from './secondBrainStats';
import type { LedgerEvent } from '@/lib/firebase/schema';

const ev = (type: LedgerEvent['type'], deptK?: string): LedgerEvent => ({
  ts: 1,
  type,
  actor: 'byte',
  deptK,
  title: type,
  summary: type,
});

const events: LedgerEvent[] = [
  ev('deliverable_approved', 'eng'),
  ev('deliverable_approved', 'eng'),
  ev('decision_made'),
  ev('stage_advanced'),
  ev('task_run', 'mkt'),
];
const depts = [
  { k: 'eng', name: 'Engineering' },
  { k: 'mkt', name: 'Marketing' },
  { k: 'ops', name: 'Ops' },
];

describe('ledgerCounts', () => {
  it('counts by category', () => {
    expect(ledgerCounts(events)).toEqual({
      deliverables: 2,
      decisions: 1,
      milestones: 1,
      tasks: 1,
    });
  });
});

describe('topicCounts', () => {
  it('counts events per dept, desc, dropping zero', () => {
    expect(topicCounts(events, depts)).toEqual([
      { deptK: 'eng', name: 'Engineering', count: 2 },
      { deptK: 'mkt', name: 'Marketing', count: 1 },
    ]);
  });
});
