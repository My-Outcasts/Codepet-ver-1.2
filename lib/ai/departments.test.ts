import { describe, it, expect } from 'vitest';
import { OB_STAGES } from '../data';
import { DEPARTMENT_FOUNDATIONS, departmentBlock, departmentBrief } from './departments';

const KEYS = ['eng', 'design', 'mkt', 'sales', 'support', 'fin', 'ops', 'legal'];

describe('DEPARTMENT_FOUNDATIONS completeness', () => {
  it('has exactly the 8 department keys', () => {
    expect(Object.keys(DEPARTMENT_FOUNDATIONS).sort()).toEqual([...KEYS].sort());
  });
  it('every department has a non-empty mandate, skills, and anti-patterns', () => {
    for (const k of KEYS) {
      const f = DEPARTMENT_FOUNDATIONS[k];
      expect(f.mandate.trim().length, `${k} mandate`).toBeGreaterThan(0);
      expect(f.skills.length, `${k} skills`).toBeGreaterThan(0);
      expect(
        f.skills.every((s) => s.trim().length > 0),
        `${k} skills non-empty`,
      ).toBe(true);
      expect(f.antipatterns.length, `${k} antipatterns`).toBeGreaterThan(0);
    }
  });
  it('every stageFocus has exactly the 6 OB_STAGES keys, all non-empty', () => {
    for (const k of KEYS) {
      const focus = DEPARTMENT_FOUNDATIONS[k].stageFocus;
      expect(Object.keys(focus).sort(), `${k} stage keys`).toEqual([...OB_STAGES].sort());
      for (const s of OB_STAGES) {
        expect(focus[s].trim().length, `${k}/${s}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('departmentBlock', () => {
  it('includes mandate, skills, the current-stage focus, and anti-patterns', () => {
    const b = departmentBlock('mkt', 'Private beta');
    expect(b).toContain(DEPARTMENT_FOUNDATIONS.mkt.mandate);
    expect(b).toContain(DEPARTMENT_FOUNDATIONS.mkt.skills[0]);
    expect(b).toContain(DEPARTMENT_FOUNDATIONS.mkt.stageFocus['Private beta']);
    expect(b).toContain(DEPARTMENT_FOUNDATIONS.mkt.antipatterns[0]);
  });
  it('includes ONLY the current stage focus, not other stages', () => {
    const b = departmentBlock('mkt', 'Private beta');
    expect(b).not.toContain(DEPARTMENT_FOUNDATIONS.mkt.stageFocus['Growing']);
  });
  it('unknown key -> empty string', () => {
    expect(departmentBlock('nope', 'Private beta')).toBe('');
  });
  it('unknown stage -> block without a focus line (never throws)', () => {
    const b = departmentBlock('eng', 'Nonsense');
    expect(b).toContain(DEPARTMENT_FOUNDATIONS.eng.mandate);
    expect(b.toLowerCase()).not.toContain('focus at the');
  });
});

describe('departmentBrief', () => {
  it('includes mandate + skills only (no stage focus, no anti-patterns)', () => {
    const b = departmentBrief('eng');
    expect(b).toContain(DEPARTMENT_FOUNDATIONS.eng.mandate);
    expect(b).toContain(DEPARTMENT_FOUNDATIONS.eng.skills[0]);
    expect(b).not.toContain(DEPARTMENT_FOUNDATIONS.eng.stageFocus['Just an idea']);
    expect(b).not.toContain(DEPARTMENT_FOUNDATIONS.eng.antipatterns[0]);
  });
  it('unknown key -> empty string', () => {
    expect(departmentBrief('nope')).toBe('');
  });
  it('tolerates a null/undefined key -> empty string (chat with no department in focus)', () => {
    expect(departmentBrief(undefined)).toBe('');
    expect(departmentBrief(null)).toBe('');
  });
});
