import { describe, it, expect } from 'vitest';
import { buildKnowledgeGraph } from './knowledgeGraph';
import type { FeatureCluster } from './featureClusters';
import type { LedgerEvent } from '@/lib/firebase/schema';

const events: LedgerEvent[] = [
  { ts: 3, type: 'deliverable_approved', actor: 'byte', refType: 'library', refId: 'L1', title: 'API v1', summary: 'Approved API v1.' },
  { ts: 2, type: 'decision_made', actor: 'byte', refType: 'decision', refId: 'Voyage', title: 'Use Voyage', summary: 'Decision: use Voyage.' },
  { ts: 1, type: 'stage_advanced', actor: 'founder', refType: 'stage', refId: 'Launch', title: 'Launch', summary: 'Advanced to Launch.' },
];

const clusters: FeatureCluster[] = [
  { id: 'cluster:0', label: 'Api', memberKeys: ['ev:library:L1'] },
  { id: 'cluster:1', label: 'Voyage', memberKeys: ['ev:decision:Voyage'] },
];

describe('buildKnowledgeGraph (cluster spine)', () => {
  it('adds a company node and one department-kind hub per cluster', () => {
    const { nodes } = buildKnowledgeGraph(events, clusters);
    expect(nodes.find((n) => n.id === 'company')).toBeTruthy();
    const hubs = nodes.filter((n) => n.kind === 'department');
    expect(hubs.map((h) => h.id).sort()).toEqual(['cluster:0', 'cluster:1']);
    expect(hubs.find((h) => h.id === 'cluster:0')?.name).toBe('Api');
  });

  it('attaches each knowledge node to its cluster hub', () => {
    const { nodes, edges } = buildKnowledgeGraph(events, clusters);
    const api = nodes.find((n) => n.id === 'ev:library:L1')!;
    expect(api.deptK).toBe('cluster:0');
    expect(edges.some((e) => e.source === 'ev:library:L1' && e.target === 'cluster:0')).toBe(true);
  });

  it('attaches to company when an event is in no cluster', () => {
    const { edges } = buildKnowledgeGraph(events, [
      { id: 'cluster:0', label: 'Api', memberKeys: ['ev:library:L1'] },
    ]);
    expect(edges.some((e) => e.source === 'ev:decision:Voyage' && e.target === 'company')).toBe(true);
  });

  it('weights a referenced cluster higher than an unreferenced one', () => {
    const withEmpty: FeatureCluster[] = [...clusters, { id: 'cluster:2', label: 'Empty', memberKeys: [] }];
    const { nodes } = buildKnowledgeGraph(events, withEmpty);
    const api = nodes.find((n) => n.id === 'cluster:0')!;
    const empty = nodes.find((n) => n.id === 'cluster:2')!;
    expect(api.weight).toBeGreaterThan(empty.weight); // cluster:0 owns a deliverable, cluster:2 owns nothing
  });

  it('dedupes events that share a ref key', () => {
    const dup = [...events, events[0]];
    const { nodes } = buildKnowledgeGraph(dup, clusters);
    expect(nodes.filter((n) => n.kind === 'deliverable')).toHaveLength(1);
  });

  it('is a pure function (same input -> equal output)', () => {
    expect(buildKnowledgeGraph(events, clusters)).toEqual(buildKnowledgeGraph(events, clusters));
  });

  it('chains same-cluster knowledge nodes with references edges (density)', () => {
    const clustered: LedgerEvent[] = [
      { ts: 3, type: 'deliverable_approved', actor: 'byte', refType: 'library', refId: 'L1', title: 'A', summary: 'a' },
      { ts: 2, type: 'deliverable_approved', actor: 'byte', refType: 'library', refId: 'L2', title: 'B', summary: 'b' },
      { ts: 1, type: 'deliverable_approved', actor: 'byte', refType: 'library', refId: 'L3', title: 'C', summary: 'c' },
    ];
    const twoClusters: FeatureCluster[] = [
      { id: 'cluster:0', label: 'Group A', memberKeys: ['ev:library:L1', 'ev:library:L2'] },
      { id: 'cluster:1', label: 'Group B', memberKeys: ['ev:library:L3'] },
    ];
    const { nodes, edges } = buildKnowledgeGraph(clustered, twoClusters);
    const refs = edges.filter((e) => e.kind === 'references');
    expect(refs.length).toBeGreaterThan(0);
    const clusterOf = new Map(nodes.map((n) => [n.id, n.deptK]));
    for (const e of refs) {
      expect(clusterOf.get(e.source)).toBe(clusterOf.get(e.target)); // same-cluster only
    }
  });

  it('marks the highest-weight knowledge nodes with a persistent label', () => {
    const { nodes } = buildKnowledgeGraph(events, clusters);
    const labeled = nodes.filter((n) => n.label);
    expect(labeled.length).toBeGreaterThan(0);
    expect(labeled.every((n) => n.kind !== 'company' && n.kind !== 'department')).toBe(true);
  });

  it('never emits an edge whose endpoint is not a node (would crash the force graph)', () => {
    const mixed: LedgerEvent[] = [
      ...events,
      // a task not a member of any cluster
      { ts: 5, type: 'task_run', actor: 'byte', refType: 'task', refId: 'g1', title: 'Ghost', summary: 'x' },
      // an unclustered fact
      { ts: 6, type: 'fact_remembered', actor: 'byte', refType: 'fact', refId: 'f1', title: 'Fact', summary: 'y' },
    ];
    const { nodes, edges } = buildKnowledgeGraph(mixed, clusters);
    const ids = new Set(nodes.map((n) => n.id));
    for (const e of edges) {
      expect(ids.has(e.source), `source ${e.source}`).toBe(true);
      expect(ids.has(e.target), `target ${e.target}`).toBe(true);
    }
  });
});
