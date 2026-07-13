// Pure ledger → knowledge-graph builder. Mirrors roadmapLayout.ts: no side effects,
// no Firestore, fully unit-tested. This is P1's payoff — it turns the append-only event
// ledger into the typed, cross-linked graph the Second Brain view renders, replacing the
// authored "company → 8 departments → tasks" tree with what has actually happened.
import type { LedgerEvent } from '@/lib/firebase/schema';
import { eventNodeId, type FeatureCluster } from './featureClusters';

export type KGNodeKind =
  | 'company'
  | 'department'
  | 'milestone'
  | 'deliverable'
  | 'decision'
  | 'fact'
  | 'session'
  | 'task';

export interface KGNode {
  id: string;
  name: string;
  kind: KGNodeKind;
  weight: number;
  deptK?: string;
  refType?: string;
  refId?: string;
  ts?: number;
  /** Show a persistent label (the high-weight nodes) vs. hover-only for the rest. */
  label?: boolean;
}

/** How many same-department knowledge nodes to chain with `references` edges (density), and how
 *  many top-weight nodes get a persistent label. Kept small so the graph reads as a web, not a mesh. */
const REFERENCES_CAP = 2;
const LABEL_TOP_N = 8;

export type KGEdgeKind =
  | 'belongs_to'
  | 'produced'
  | 'advances'
  | 'depends_on'
  | 'references'
  | 'supersedes'
  | 'grounds'
  | 'spine';

export interface KGEdge {
  source: string;
  target: string;
  kind: KGEdgeKind;
}

const KIND_OF: Partial<Record<LedgerEvent['type'], KGNodeKind>> = {
  deliverable_approved: 'deliverable',
  decision_made: 'decision',
  fact_remembered: 'fact',
  task_run: 'task',
  build_session: 'session',
  stage_advanced: 'milestone',
};

const EDGE_OF: Partial<Record<LedgerEvent['type'], KGEdgeKind>> = {
  deliverable_approved: 'belongs_to',
  task_run: 'produced',
  stage_advanced: 'advances',
  fact_remembered: 'grounds',
};

/** Recency component: newest events (rank 0) weigh most, decaying over rank. */
function recencyWeight(rank: number, total: number): number {
  return total <= 1 ? 1 : 1 - rank / total;
}

export function buildKnowledgeGraph(
  events: LedgerEvent[],
  clusters: FeatureCluster[],
): { nodes: KGNode[]; edges: KGEdge[] } {
  const nodes: KGNode[] = [];
  const edges: KGEdge[] = [];
  const seen = new Set<string>();
  const inDegree = new Map<string, number>();
  const bump = (id: string) => inDegree.set(id, (inDegree.get(id) ?? 0) + 1);

  // Spine: company + one hub per feature-area cluster (reuse the 'department' kind so the
  // renderer's hub styling is unchanged). Map each member key → its cluster id.
  nodes.push({ id: 'company', name: 'Your company', kind: 'company', weight: 10 });
  seen.add('company');
  const clusterIds = new Set<string>();
  const clusterOf = new Map<string, string>();
  for (const c of clusters) {
    nodes.push({ id: c.id, name: c.label, kind: 'department', weight: 1, deptK: c.id });
    seen.add(c.id);
    clusterIds.add(c.id);
    edges.push({ source: 'company', target: c.id, kind: 'spine' });
    for (const k of c.memberKeys) clusterOf.set(k, c.id);
  }

  // Knowledge nodes from the ledger, newest-first so recency weighting is stable.
  const sorted = [...events].sort((a, b) => b.ts - a.ts);
  sorted.forEach((ev, i) => {
    const kind = KIND_OF[ev.type];
    if (!kind) return;
    const id = eventNodeId(ev);
    if (seen.has(id)) return; // dedupe on the deterministic ref key
    seen.add(id);
    const clusterId = clusterOf.get(id);
    nodes.push({
      id,
      name: ev.title,
      kind,
      weight: recencyWeight(i, sorted.length),
      deptK: clusterId, // carries the cluster id (renderer reads deptK as the node's home)
      refType: ev.refType,
      refId: ev.refId,
      ts: ev.ts,
    });
    const target = clusterId && clusterIds.has(clusterId) ? clusterId : 'company';
    edges.push({ source: id, target, kind: EDGE_OF[ev.type] ?? 'references' });
    bump(target);
  });

  // Fold reference count into weight — this is what makes the galaxy uneven: often-referenced
  // and recent nodes shine brighter than dormant ones.
  for (const n of nodes) n.weight += inDegree.get(n.id) ?? 0;

  // Density: chain same-cluster knowledge nodes with `references` edges so each cluster reads
  // as a connected web, not stars on a stalk. A simple chain caps each node at REFERENCES_CAP.
  // Grouping key is the cluster id carried on deptK (set above from the feature-area cluster).
  const knowledge = nodes.filter((n) => n.kind !== 'company' && n.kind !== 'department');
  const byCluster = new Map<string, KGNode[]>();
  for (const n of knowledge) {
    if (!n.deptK) continue;
    const g = byCluster.get(n.deptK) ?? [];
    g.push(n);
    byCluster.set(n.deptK, g);
  }
  for (const group of byCluster.values()) {
    for (let i = 0; i < group.length; i++) {
      // Connect each node to its next REFERENCES_CAP siblings → a small web per cluster
      // (not a single chain), so departments read as connected constellations.
      for (let j = 1; j <= REFERENCES_CAP && i + j < group.length; j++) {
        edges.push({ source: group[i].id, target: group[i + j].id, kind: 'references' });
      }
    }
  }

  // Persistent labels for the highest-weight knowledge nodes; the rest stay hover-only.
  [...knowledge]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, LABEL_TOP_N)
    .forEach((n) => {
      n.label = true;
    });

  return { nodes, edges };
}
