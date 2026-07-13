import { describe, it, expect } from 'vitest';
import { clusterEvents, eventNodeId, type FeatureCluster } from './featureClusters';
import type { LedgerEvent } from '@/lib/firebase/schema';

const ev = (
  type: LedgerEvent['type'],
  refId: string,
  title: string,
  summary: string,
  ts = 1,
  extra: Partial<LedgerEvent> = {},
): LedgerEvent => ({
  ts,
  type,
  actor: 'byte',
  refType: type === 'deliverable_approved' ? 'library' : 'decision',
  refId,
  title,
  summary,
  ...extra,
});

describe('eventNodeId', () => {
  it('uses refType:refId when present', () => {
    expect(eventNodeId({ type: 'decision_made', refType: 'decision', refId: 'x', ts: 9 })).toBe(
      'ev:decision:x',
    );
  });
  it('falls back to type:ts when refType/refId are absent', () => {
    expect(eventNodeId({ type: 'task_run', ts: 42 })).toBe('ev:task_run:42');
  });
});

describe('clusterEvents', () => {
  it('returns no clusters for no events', () => {
    expect(clusterEvents([])).toEqual([]);
  });

  it('returns a single cluster for 3 or fewer events', () => {
    const out = clusterEvents([
      ev('deliverable_approved', 'a', 'Payment page', 'checkout billing stripe'),
      ev('decision_made', 'b', 'Onboarding', 'welcome signup flow'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].memberKeys).toHaveLength(2);
  });

  it('is deterministic regardless of input order', () => {
    const items = [
      ev('deliverable_approved', 'p1', 'Payment page', 'checkout billing stripe payment'),
      ev('deliverable_approved', 'p2', 'Payment refunds', 'refund billing stripe payment'),
      ev('decision_made', 'p3', 'Payment provider', 'chose stripe for payment billing'),
      ev('deliverable_approved', 'o1', 'Onboarding welcome', 'welcome signup onboarding flow'),
      ev('decision_made', 'o2', 'Onboarding steps', 'signup onboarding welcome steps'),
      ev('task_run', 'o3', 'Onboarding copy', 'welcome onboarding signup copy'),
    ];
    const a = clusterEvents(items);
    const b = clusterEvents([...items].reverse());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('groups semantically-similar events and names the cluster from shared terms', () => {
    const out = clusterEvents([
      ev('deliverable_approved', 'p1', 'Payment page', 'checkout billing stripe payment'),
      ev('deliverable_approved', 'p2', 'Payment refunds', 'refund billing stripe payment'),
      ev('decision_made', 'p3', 'Payment provider', 'chose stripe for payment billing'),
      ev('deliverable_approved', 'o1', 'Onboarding welcome', 'welcome signup onboarding flow'),
      ev('decision_made', 'o2', 'Onboarding steps', 'signup onboarding welcome steps'),
      ev('task_run', 'o3', 'Onboarding copy', 'welcome onboarding signup copy'),
    ]);
    expect(out).toHaveLength(2);
    // Each cluster's 3 members all share a topic.
    const keysOf = (label: string) =>
      out.find((c) => c.label.toLowerCase().includes(label))?.memberKeys ?? [];
    expect(keysOf('payment')).toHaveLength(3);
    expect(keysOf('onboarding')).toHaveLength(3);
  });

  it('uses real embeddings when every event has a vec', () => {
    const withVec = (refId: string, vec: number[]): LedgerEvent =>
      ev('deliverable_approved', refId, refId, refId, 1, { vec });
    const out = clusterEvents([
      withVec('a', [1, 0]),
      withVec('b', [0.98, 0.02]),
      withVec('c', [0, 1]),
      withVec('d', [0.02, 0.98]),
      withVec('e', [0.95, 0.05]),
      withVec('f', [0.05, 0.95]),
    ]);
    expect(out).toHaveLength(2);
    // a,b,e cluster together; c,d,f cluster together (by vector direction).
    const cluster = (k: string) => out.find((c) => c.memberKeys.includes(`ev:library:${k}`));
    expect(cluster('a')).toBe(cluster('b'));
    expect(cluster('a')).toBe(cluster('e'));
    expect(cluster('c')).toBe(cluster('d'));
    expect(cluster('a')).not.toBe(cluster('c'));
  });

  it('skips non-knowledge event types (e.g. toolkit_used)', () => {
    const out = clusterEvents([
      ev('deliverable_approved', 'a', 'X', 'x'),
      { ts: 2, type: 'toolkit_used', actor: 'byte', title: 'tool', summary: 'used a tool' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].memberKeys).toEqual(['ev:library:a']);
  });
});
