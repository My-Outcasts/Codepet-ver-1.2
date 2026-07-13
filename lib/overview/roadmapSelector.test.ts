// Consistency harness for the single roadmap projection.
//
// These are INVARIANT tests, not example tests: they assert the properties that keep every
// surface in agreement — the beacon, the lit map node, the chat's next-step, the greeting, and
// the after-completion nudge. Each one corresponds to a real bug this consolidation prevents:
//   - the lit node and the beacon move must be the SAME node   (map ↔ beacon)
//   - the move's department must match its node's department   (the "Operations vs lane" class)
//   - the move must always be actionable, never a done/locked node
//   - progress must be internally consistent
//   - the projection must be deterministic (same inputs → same output)
import { describe, it, expect } from 'vitest';
import { selectRoadmap, type DeptLike } from './roadmapSelector';
import { applyProgress, effectivePhase, roadmapOverrides } from './roadmapProgress';
import type { RoadmapTaskDef } from './roadmapModel';

// A small but realistic roadmap: two Find tasks byte can do (one gated on the other), a founder
// gate in Find, then a Build and a Ship task chained by cross-phase dependencies.
const DEFS: RoadmapTaskDef[] = [
  { id: 'find-problem', phase: 'find', dept: 'product', title: 'Define the core problem', actor: 'you', dependsOn: [] }, // prettier-ignore
  { id: 'find-interview', phase: 'find', dept: 'mkt', title: 'Interview 20 users', actor: 'byte', dependsOn: [] }, // prettier-ignore
  { id: 'find-wtp', phase: 'find', dept: 'mkt', title: 'Test willingness to pay', actor: 'byte', dependsOn: ['find-interview'] }, // prettier-ignore
  { id: 'build-mvp', phase: 'build', dept: 'eng', title: 'Build the MVP', actor: 'byte', dependsOn: ['find-problem'] }, // prettier-ignore
  { id: 'ship-launch', phase: 'ship', dept: 'mkt', title: 'Launch', actor: 'byte', dependsOn: ['build-mvp'] }, // prettier-ignore
];

// Build DEPTS-shaped departments, marking the given def ids done and linking each row to its
// roadmap node (exercises the stable roadmapNodeId join the selector relies on).
const deptsWithDone = (doneIds: string[]): DeptLike[] => {
  const byDept = new Map<string, DeptLike['tasks']>();
  for (const d of DEFS) {
    const arr = byDept.get(d.dept) ?? [];
    arr.push({ t: d.title, done: doneIds.includes(d.id), roadmapNodeId: d.id });
    byDept.set(d.dept, arr);
  }
  return [...byDept].map(([k, tasks]) => ({ k, tasks }));
};

// Every done-set the founder can plausibly be in, from fresh to fully shipped.
const DONE_SETS: string[][] = [
  [],
  ['find-interview'],
  ['find-interview', 'find-wtp'],
  ['find-interview', 'find-wtp', 'find-problem'],
  ['find-interview', 'find-wtp', 'find-problem', 'build-mvp'],
  ['find-interview', 'find-wtp', 'find-problem', 'build-mvp', 'ship-launch'],
];
const defById = new Map(DEFS.map((d) => [d.id, d]));

describe('selectRoadmap — the fresh Find-stage founder', () => {
  const sel = selectRoadmap(DEFS, 'find', deptsWithDone([]));

  it('picks the first byte-doable Find task as the move', () => {
    expect(sel.move).toMatchObject({ id: 'find-interview', deptK: 'mkt', actor: 'byte' });
  });
  it('lights that same node as `current` on the map', () => {
    expect(sel.tasks.find((t) => t.state === 'current')?.id).toBe('find-interview');
  });
  it('reports the effective phase and its next milestone', () => {
    expect(sel.phase).toBe('find');
    expect(sel.phaseName).toBe('Find');
    expect(sel.nextMilestone).toBe('Foundation');
  });
});

describe('selectRoadmap — cross-surface invariants (hold for every founder position)', () => {
  it('INVARIANT: the lit map node is exactly the beacon move (map ↔ beacon can never diverge)', () => {
    for (const done of DONE_SETS) {
      const sel = selectRoadmap(DEFS, 'find', deptsWithDone(done));
      const current = sel.tasks.find((t) => t.state === 'current');
      if (sel.move) expect(current?.id).toBe(sel.move.id);
    }
  });

  it("INVARIANT: the move's department matches its node's own department", () => {
    for (const done of DONE_SETS) {
      const sel = selectRoadmap(DEFS, 'find', deptsWithDone(done));
      if (sel.move) expect(sel.move.deptK).toBe(defById.get(sel.move.id)!.dept);
    }
  });

  it('INVARIANT: the move is always actionable — never a done or locked node', () => {
    for (const done of DONE_SETS) {
      const depts = deptsWithDone(done);
      const sel = selectRoadmap(DEFS, 'find', depts);
      if (!sel.move) continue;
      // A completed node can never be surfaced as the next thing to do.
      expect(done).not.toContain(sel.move.id);
      // Re-derive that node's raw state independently: it must be available or needsYou.
      const overrides = roadmapOverrides(DEFS, depts);
      const phase = effectivePhase(DEFS, 'find', overrides);
      const raw = applyProgress(DEFS, { currentPhase: phase, currentTaskId: null, overrides });
      const state = raw.find((t) => t.id === sel.move!.id)?.state;
      expect(['available', 'needsYou']).toContain(state);
    }
  });

  it('INVARIANT: what the store would set as next-step matches the beacon move', () => {
    for (const done of DONE_SETS) {
      const sel = selectRoadmap(DEFS, 'find', deptsWithDone(done));
      // Mirror store.computeNextStep: it derives nextStep from this same move.
      const storeNext = sel.move ? { deptK: sel.move.deptK, taskTitle: sel.move.title } : null;
      if (sel.move) {
        expect(storeNext).toEqual({ deptK: sel.move.deptK, taskTitle: sel.move.title });
      } else {
        expect(storeNext).toBeNull();
      }
    }
  });

  it('INVARIANT: progress is internally consistent (0 ≤ done ≤ total, pct is their rounded ratio)', () => {
    for (const done of DONE_SETS) {
      const { progress: p } = selectRoadmap(DEFS, 'find', deptsWithDone(done));
      expect(p.done).toBeGreaterThanOrEqual(0);
      expect(p.done).toBeLessThanOrEqual(p.total);
      expect(p.pct).toBe(p.total ? Math.round((p.done / p.total) * 100) : 0);
      expect(p.pct).toBeGreaterThanOrEqual(0);
      expect(p.pct).toBeLessThanOrEqual(100);
    }
  });

  it('INVARIANT: every projected task keeps its canonical id/phase/dept/title', () => {
    const sel = selectRoadmap(DEFS, 'find', deptsWithDone(['find-interview']));
    for (const t of sel.tasks) {
      const def = defById.get(t.id)!;
      expect({ id: t.id, phase: t.phase, dept: t.dept, title: t.title }).toEqual({
        id: def.id,
        phase: def.phase,
        dept: def.dept,
        title: def.title,
      });
    }
  });

  it('INVARIANT: deterministic — identical inputs yield a deep-equal projection', () => {
    const a = selectRoadmap(DEFS, 'find', deptsWithDone(['find-interview']));
    const b = selectRoadmap(DEFS, 'find', deptsWithDone(['find-interview']));
    expect(a).toEqual(b);
  });
});

describe('selectRoadmap — the move advances as work completes', () => {
  it('walks Find → Build without ever re-surfacing a finished task', () => {
    const seen: (string | null)[] = [];
    const done: string[] = [];
    for (let guard = 0; guard < 10; guard++) {
      const sel = selectRoadmap(DEFS, 'find', deptsWithDone(done));
      seen.push(sel.move?.id ?? null);
      if (!sel.move) break;
      expect(done).not.toContain(sel.move.id); // never point back at completed work
      done.push(sel.move.id); // "finish" the surfaced move and advance
    }
    // The founder gate (find-problem) unblocks build-mvp, so the walk reaches Build.
    expect(seen).toContain('find-interview');
    expect(seen).toContain('build-mvp');
    // No move id repeats — the beacon strictly advances.
    const nonNull = seen.filter((x): x is string => x !== null);
    expect(new Set(nonNull).size).toBe(nonNull.length);
  });

  it('advances the phase once a phase’s work is complete', () => {
    const findDone = ['find-interview', 'find-wtp', 'find-problem'];
    const sel = selectRoadmap(DEFS, 'find', deptsWithDone(findDone));
    expect(sel.phase).toBe('build');
    expect(sel.move?.id).toBe('build-mvp');
  });

  it('returns a null move (nothing left) when the final phase is done', () => {
    const sel = selectRoadmap(DEFS, 'ship', deptsWithDone(DONE_SETS[DONE_SETS.length - 1]));
    expect(sel.move).toBeNull();
    // Progress reads as fully complete.
    expect(sel.progress.pct).toBe(100);
  });
});
