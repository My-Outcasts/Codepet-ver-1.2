import { describe, it, expect } from 'vitest';
import { deptProgress, overviewProgress } from './progress';
import type { Dept } from '../data';

// Minimal Dept factory — only the fields the helpers read.
const dept = (dones: boolean[], later = false): Dept =>
  ({ tasks: dones.map((done) => ({ done })), later }) as unknown as Dept;

describe('deptProgress', () => {
  it('counts done/total and rounds pct', () => {
    expect(deptProgress(dept([true, true, false, false, false]))).toEqual({
      done: 2,
      total: 5,
      pct: 40,
    });
  });
  it('0 tasks → 0/0/0 (no divide-by-zero)', () => {
    expect(deptProgress(dept([]))).toEqual({ done: 0, total: 0, pct: 0 });
  });
  it('all done → 100', () => {
    expect(deptProgress(dept([true, true])).pct).toBe(100);
  });
});

describe('overviewProgress', () => {
  it('sums active departments; excludes dormant (later)', () => {
    const r = overviewProgress([
      dept([true, true, false]), // 2/3 active
      dept([true]), // 1/1 active (complete area)
      dept([false, false], true), // dormant — excluded
    ]);
    expect(r.done).toBe(3);
    expect(r.total).toBe(4);
    expect(r.areasTotal).toBe(2);
    expect(r.areasDone).toBe(1); // only the 1/1 department
  });
  it('never rounds to 100 while a task is open (100%-iff-complete)', () => {
    // 199/200 done across active depts must read 99, not 100.
    const big = { tasks: Array.from({ length: 200 }, (_, i) => ({ done: i < 199 })), later: false };
    expect(overviewProgress([big as unknown as Dept]).pct).toBe(99);
  });
  it('all complete → 100', () => {
    expect(overviewProgress([dept([true, true]), dept([true])]).pct).toBe(100);
  });
  it('empty department not counted as an area done', () => {
    const r = overviewProgress([dept([])]);
    expect(r).toEqual({ done: 0, total: 0, pct: 0, areasDone: 0, areasTotal: 1 });
  });
  it('no active departments → all zeros', () => {
    expect(overviewProgress([dept([true], true)])).toEqual({
      done: 0,
      total: 0,
      pct: 0,
      areasDone: 0,
      areasTotal: 0,
    });
  });
});
