import { describe, it, expect } from 'vitest';
import { buildKnowledgeGraph } from './knowledgeGraph';
import type { LedgerEvent } from '@/lib/firebase/schema';

const depts = [
  { k: 'eng', name: 'Engineering', tasks: [], status: 'idle' },
  { k: 'mkt', name: 'Marketing', tasks: [], status: 'idle' },
] as any;

const events: LedgerEvent[] = [
  { ts: 3, type: 'deliverable_approved', actor: 'byte', deptK: 'eng', refType: 'library', refId: 'eng-3', title: 'API v1', summary: 'Approved API v1.' },
  { ts: 2, type: 'decision_made', actor: 'byte', refType: 'decision', refId: 'Voyage', title: 'Use Voyage', summary: 'Decision: use Voyage.' },
  { ts: 1, type: 'stage_advanced', actor: 'founder', refType: 'stage', refId: 'Launch', title: 'Launch', summary: 'Advanced to Launch.' },
];

describe('buildKnowledgeGraph', () => {
  it('always emits a company spine node + one node per department', () => {
    const { nodes } = buildKnowledgeGraph([], depts);
    expect(nodes.find((n) => n.kind === 'company')).toBeTruthy();
    expect(nodes.filter((n) => n.kind === 'department')).toHaveLength(2);
  });

  it('creates a deliverable node linked to its department via belongs_to', () => {
    const { nodes, edges } = buildKnowledgeGraph(events, depts);
    const deliverable = nodes.find((n) => n.kind === 'deliverable');
    expect(deliverable).toBeTruthy();
    expect(
      edges.some(
        (e) => e.kind === 'belongs_to' && e.source === deliverable!.id && e.target === 'dept:eng',
      ),
    ).toBe(true);
  });

  it('links dept-less knowledge (a decision) to the company spine', () => {
    const { nodes, edges } = buildKnowledgeGraph(events, depts);
    const decision = nodes.find((n) => n.kind === 'decision')!;
    expect(edges.some((e) => e.source === decision.id && e.target === 'company')).toBe(true);
  });

  it('weights a referenced department higher than an unreferenced one', () => {
    const { nodes } = buildKnowledgeGraph(events, depts);
    const eng = nodes.find((n) => n.id === 'dept:eng')!;
    const mkt = nodes.find((n) => n.id === 'dept:mkt')!;
    expect(eng.weight).toBeGreaterThan(mkt.weight); // eng owns a deliverable
  });

  it('dedupes events that share a ref key', () => {
    const dup = [...events, events[0]];
    const { nodes } = buildKnowledgeGraph(dup, depts);
    expect(nodes.filter((n) => n.kind === 'deliverable')).toHaveLength(1);
  });

  it('is a pure function (same input -> equal output)', () => {
    expect(buildKnowledgeGraph(events, depts)).toEqual(buildKnowledgeGraph(events, depts));
  });
});
