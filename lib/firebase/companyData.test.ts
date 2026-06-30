import { describe, it, expect, beforeEach } from 'vitest';
import {
  envStateFromCatalog,
  resetCompanyData,
  applyPersonalization,
  type PersonalizedDept,
} from './companyData';
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

describe('applyPersonalization (Phase 5.3 seed templating)', () => {
  beforeEach(() => resetCompanyData());

  const genFor = (k: string): PersonalizedDept => {
    const seed = DEPTS_SEED.find((d) => d.k === k)!;
    return {
      k,
      need: `NEED for ${k}`,
      byte: `BYTE for ${k}`,
      tasks: seed.tasks.map((_, i) => ({ t: `T${i}-${k}`, d: `D${i}-${k}` })),
    };
  };

  it('overwrites only the text fields, preserving status/pend/run/out/payloads', () => {
    const k = DEPTS[0].k;
    const seed = DEPTS_SEED.find((d) => d.k === k)!;
    const changed = applyPersonalization([genFor(k)]);

    expect(changed).toHaveLength(1);
    const dept = DEPTS.find((d) => d.k === k)!;
    // text fields rewritten
    expect(dept.need).toBe(`NEED for ${k}`);
    expect(dept.byte).toBe(`BYTE for ${k}`);
    expect(dept.tasks[0].t).toBe(`T0-${k}`);
    expect(dept.tasks[0].d).toBe(`D0-${k}`);
    // structural / payload fields untouched
    expect(dept.status).toBe(seed.status);
    expect(dept.pend).toBe(seed.pend);
    expect(dept.tasks[0].run).toBe(seed.tasks[0].run);
    expect(dept.tasks[0].out).toBe(seed.tasks[0].out);
    expect(dept.tasks[0].site).toBe(seed.tasks[0].site);
  });

  it('skips a department whose task count does not match the seed (defensive)', () => {
    const k = DEPTS[0].k;
    const seedNeed = DEPTS_SEED.find((d) => d.k === k)!.need;
    const bad: PersonalizedDept = { k, need: 'X', byte: 'Y', tasks: [{ t: 'only-one', d: '' }] };
    const changed = applyPersonalization([bad]);

    expect(changed).toHaveLength(0);
    expect(DEPTS.find((d) => d.k === k)!.need).toBe(seedNeed); // untouched
  });

  it('ignores unknown department keys and blank fields', () => {
    const k = DEPTS[0].k;
    const seed = DEPTS_SEED.find((d) => d.k === k)!;
    const blanked: PersonalizedDept = {
      k,
      need: '   ',
      byte: '',
      tasks: seed.tasks.map(() => ({ t: '', d: '' })),
    };
    const unknown: PersonalizedDept = { k: '__nope__', need: 'a', byte: 'b', tasks: [] };
    const changed = applyPersonalization([unknown, blanked]);

    // unknown key contributes nothing; blank-field dept is a no-op merge
    const dept = DEPTS.find((d) => d.k === k)!;
    expect(dept.need).toBe(seed.need); // blanks didn't overwrite
    expect(dept.byte).toBe(seed.byte);
    expect(changed.map((d) => d.k)).not.toContain('__nope__');
  });
});
