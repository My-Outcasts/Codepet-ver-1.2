import { describe, it, expect } from 'vitest';
import { deptRingPosition, taskRingPosition, DEPT_R, TASK_R, DEPTH } from './layout';

const hypot2 = (a: number, b: number) => Math.hypot(a, b);

describe('deptRingPosition', () => {
  it('places N departments on a ring of radius DEPT_R at equal angles', () => {
    const count = 8;
    for (let i = 0; i < count; i++) {
      const p = deptRingPosition(i, count);
      expect(hypot2(p.x, p.y)).toBeCloseTo(DEPT_R, 3); // in-plane radius is exact
    }
    // even spacing: dept 0 and dept 2 (a quarter turn apart) are perpendicular
    const p0 = deptRingPosition(0, count);
    const p2 = deptRingPosition(2, count);
    const dot = p0.x * p2.x + p0.y * p2.y;
    expect(dot).toBeCloseTo(0, 3);
  });

  it('compresses depth to at most DEPTH * DEPT_R', () => {
    for (let i = 0; i < 12; i++) {
      const p = deptRingPosition(i, 12);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(DEPT_R * DEPTH + 1e-9);
    }
  });

  it('handles a single department without NaN', () => {
    const p = deptRingPosition(0, 1);
    expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
    expect(hypot2(p.x, p.y)).toBeCloseTo(DEPT_R, 3);
  });

  it('pins positions (fx/fy/fz mirror x/y/z) and is deterministic', () => {
    const a = deptRingPosition(3, 8);
    const b = deptRingPosition(3, 8);
    expect(a).toEqual(b);
    expect([a.fx, a.fy, a.fz]).toEqual([a.x, a.y, a.z]);
  });
});

describe('taskRingPosition', () => {
  const dept = { x: 100, y: 0, z: 0 };

  it('offsets tasks by TASK_R around their department', () => {
    const p = taskRingPosition(dept, 0, 3);
    expect(hypot2(p.x - dept.x, p.y - dept.y)).toBeCloseTo(TASK_R, 3);
  });

  it('never returns non-finite values and pins fx/fy/fz', () => {
    for (let i = 0; i < 5; i++) {
      const p = taskRingPosition(dept, i, 5);
      expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
      expect([p.fx, p.fy, p.fz]).toEqual([p.x, p.y, p.z]);
    }
  });
});
