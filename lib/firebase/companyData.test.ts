import { describe, it, expect } from 'vitest';
import { envStateFromCatalog, resetCompanyData } from './companyData';
import { ENV, ENV_CATS, DEPTS, DEPTS_SEED, ENV_SEED } from '../data';

describe('envStateFromCatalog', () => {
  it('snapshots every catalog category as a name→boolean map', () => {
    const state = envStateFromCatalog();
    for (const [cat] of ENV_CATS) {
      expect(state[cat], `category ${cat}`).toBeDefined();
      for (const item of ENV[cat]) {
        expect(typeof state[cat][item.n]).toBe('boolean');
      }
    }
  });
  it('reflects the catalog default on/off state (s flag)', () => {
    const state = envStateFromCatalog();
    for (const [cat] of ENV_CATS) {
      for (const item of ENV[cat]) {
        expect(state[cat][item.n]).toBe(item.s === 1);
      }
    }
  });
});

describe('resetCompanyData (per-account isolation)', () => {
  it('restores DEPTS/ENV to the pristine seed, clearing any prior-account edits', () => {
    // Simulate a signed-in account A editing its company in place.
    const dept = DEPTS[0];
    dept.status = 'attention';
    dept.pend = 99;
    if (dept.tasks[0]) dept.tasks[0].done = true;
    const cat = ENV_CATS[0][0];
    if (ENV[cat][0]) ENV[cat][0].s = ENV[cat][0].s === 1 ? 0 : 1;

    // Loading another account begins with a reset.
    resetCompanyData();

    // Every department is back to its seed (status, pend, and task-done flags).
    DEPTS.forEach((d, i) => {
      expect(d.status).toBe(DEPTS_SEED[i].status);
      expect(d.pend).toBe(DEPTS_SEED[i].pend);
      expect(d.tasks.map((t) => t.done ?? false)).toEqual(
        DEPTS_SEED[i].tasks.map((t) => t.done ?? false),
      );
    });
    // Every env toggle is back to its seed on/off state.
    for (const [c] of ENV_CATS) {
      ENV[c].forEach((item, i) => {
        expect(item.s).toBe(ENV_SEED[c][i].s);
      });
    }
  });
});
