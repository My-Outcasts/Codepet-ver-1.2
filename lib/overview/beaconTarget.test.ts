import { describe, it, expect } from 'vitest';
import { resolveBeaconTask, beaconLinkFor, type BeaconMove, type BeaconDept } from './beaconTarget';

// A minimal department fixture: one dept `mk` with a couple of tasks.
const depts = (tasks: BeaconDept['tasks'], k = 'mk'): BeaconDept[] => [{ k, tasks }];

describe('resolveBeaconTask', () => {
  it('matches by roadmapNodeId first, even when the title differs', () => {
    const d = depts([
      { t: 'Draft the launch post', done: false },
      { t: 'Totally different wording', done: false, roadmapNodeId: 'node-42' },
    ]);
    const move: BeaconMove = { deptK: 'mk', taskTitle: 'Ship launch post', nodeId: 'node-42' };
    expect(resolveBeaconTask(move, d)).toEqual({ deptK: 'mk', index: 1 });
  });

  it('finds the node-linked task across departments, not only in move.deptK', () => {
    const two: BeaconDept[] = [
      { k: 'mk', tasks: [{ t: 'Something', done: false }] },
      { k: 'fin', tasks: [{ t: 'Wire the bank', done: false, roadmapNodeId: 'node-9' }] },
    ];
    // move claims dept 'mk' but the node actually lives in 'fin' → node link wins.
    const move: BeaconMove = { deptK: 'mk', taskTitle: 'x', nodeId: 'node-9' };
    expect(resolveBeaconTask(move, two)).toEqual({ deptK: 'fin', index: 0 });
  });

  it('falls back to normalized title within move.deptK when no node matches (case/punctuation drift)', () => {
    const d = depts([
      { t: 'Set up analytics', done: false },
      { t: 'Pick your pricing — flat vs tiered!', done: false },
    ]);
    const move: BeaconMove = { deptK: 'mk', taskTitle: 'pick your pricing flat vs tiered' };
    expect(resolveBeaconTask(move, d)).toEqual({ deptK: 'mk', index: 1 });
  });

  it('returns null when nothing matches — NO legacy fallback (this is the D1 fix)', () => {
    const d = depts([{ t: 'Set up analytics', done: false }]);
    const move: BeaconMove = { deptK: 'mk', taskTitle: 'A task that was never scaffolded' };
    expect(resolveBeaconTask(move, d)).toBeNull();
  });

  it('never points at a done task (node match on a done task is skipped)', () => {
    const d = depts([{ t: 'Launch post', done: true, roadmapNodeId: 'node-1' }]);
    const move: BeaconMove = { deptK: 'mk', taskTitle: 'Launch post', nodeId: 'node-1' };
    expect(resolveBeaconTask(move, d)).toBeNull();
  });

  it('prefers the node match over a title match on a different task', () => {
    const d = depts([
      { t: 'Pricing page', done: false }, // title would match
      { t: 'Pricing page', done: false, roadmapNodeId: 'node-7' }, // node matches
    ]);
    const move: BeaconMove = { deptK: 'mk', taskTitle: 'Pricing page', nodeId: 'node-7' };
    expect(resolveBeaconTask(move, d)).toEqual({ deptK: 'mk', index: 1 });
  });

  it('returns null for a null move or empty departments', () => {
    expect(resolveBeaconTask(null, depts([{ t: 'x', done: false }]))).toBeNull();
    expect(resolveBeaconTask({ deptK: 'mk', taskTitle: 'x' }, [])).toBeNull();
  });
});

describe('beaconLinkFor', () => {
  it('returns the node id when the task IS the beacon target and is unlinked', () => {
    const d = depts([
      { t: 'Other', done: false },
      { t: 'Pick your pricing', done: false },
    ]);
    const move: BeaconMove = { deptK: 'mk', taskTitle: 'Pick your pricing', nodeId: 'node-5' };
    expect(beaconLinkFor(move, d, 'mk', 1)).toBe('node-5');
  });

  it('returns null when the task already carries a link (never re-stamp)', () => {
    const d = depts([{ t: 'Pick your pricing', done: false, roadmapNodeId: 'old' }]);
    const move: BeaconMove = { deptK: 'mk', taskTitle: 'Pick your pricing', nodeId: 'node-5' };
    expect(beaconLinkFor(move, d, 'mk', 0)).toBeNull();
  });

  it('returns null when the move carries no node id', () => {
    const d = depts([{ t: 'Pick your pricing', done: false }]);
    expect(beaconLinkFor({ deptK: 'mk', taskTitle: 'Pick your pricing' }, d, 'mk', 0)).toBeNull();
  });

  it('returns null when the task is NOT the current beacon target', () => {
    const d = depts([
      { t: 'Pick your pricing', done: false }, // the beacon target (index 0)
      { t: 'Set up analytics', done: false }, // some other task (index 1)
    ]);
    const move: BeaconMove = { deptK: 'mk', taskTitle: 'Pick your pricing', nodeId: 'node-5' };
    expect(beaconLinkFor(move, d, 'mk', 1)).toBeNull();
  });

  it('only stamps the exact node-linked target when title collides across tasks', () => {
    const d = depts([
      { t: 'Pricing page', done: false }, // title collides
      { t: 'Pricing page', done: false, roadmapNodeId: 'node-7' }, // the real target
    ]);
    const move: BeaconMove = { deptK: 'mk', taskTitle: 'Pricing page', nodeId: 'node-7' };
    // index 1 already linked → null; index 0 is not the node target → null. No mis-stamp.
    expect(beaconLinkFor(move, d, 'mk', 1)).toBeNull();
    expect(beaconLinkFor(move, d, 'mk', 0)).toBeNull();
  });
});
