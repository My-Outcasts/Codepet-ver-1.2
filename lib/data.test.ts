import { describe, it, expect } from 'vitest';
import { DEPTS, DCOL, ENV, ENV_CATS, PHASES } from './data';

describe('DEPTS seed integrity', () => {
  it('exposes the eight departments from the PRD', () => {
    expect(DEPTS).toHaveLength(8);
  });
  it('every department has a unique key and at least one task', () => {
    const keys = DEPTS.map((d) => d.k);
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of DEPTS) {
      expect(d.tasks.length).toBeGreaterThan(0);
      expect(d.name).toBeTruthy();
    }
  });
  it('every department key has a color token', () => {
    for (const d of DEPTS) {
      expect(DCOL[d.k], `color for ${d.k}`).toBeTruthy();
    }
  });
});

describe('ENV toolkit', () => {
  it('is keyed by the three categories declared in ENV_CATS', () => {
    for (const [cat] of ENV_CATS) {
      expect(ENV[cat], `env for ${cat}`).toBeDefined();
      expect(ENV[cat].length).toBeGreaterThan(0);
    }
  });
});

describe('PHASES roadmap', () => {
  it('numbers stages contiguously from 1', () => {
    const stages = PHASES.flatMap((p) => p.stages).map((s) => s.n);
    const sorted = [...stages].sort((a, b) => a - b);
    expect(sorted[0]).toBe(1);
    expect(new Set(stages).size).toBe(stages.length);
  });
});
