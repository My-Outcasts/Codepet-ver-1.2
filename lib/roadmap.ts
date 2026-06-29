// Roadmap stage logic — ported from the draft. These read the live `done`
// state off DEPTS, so they must be called on each render (post-mutation).
import { DEPTS, STAGE_TASKS, NODES, byN, type Dept, type Task } from './data';

export interface StageTaskRef { dept: Dept; task: Task; }

export function stageTasks(num: number): StageTaskRef[] {
  return (STAGE_TASKS[num] || [])
    .map(([k, t]) => {
      const d = DEPTS.find((x) => x.k === k);
      const task = d && d.tasks.find((x) => x.t === t);
      return task && d ? { dept: d, task } : null;
    })
    .filter((x): x is StageTaskRef => Boolean(x));
}

export function stageProgress(num: number): { done: number; total: number } {
  const ts = stageTasks(num);
  return { done: ts.filter((x) => x.task.done).length, total: ts.length };
}

export function isStageDone(s: any): boolean {
  if (STAGE_TASKS[s.n]) {
    const p = stageProgress(s.n);
    return p.total > 0 && p.done === p.total;
  }
  return s.status === 'done';
}

// effective state of a node: done | locked | now | next
export function eff(n: any): 'done' | 'locked' | 'now' | 'next' {
  if (isStageDone(n)) return 'done';
  if (!n.deps.every((d: number) => isStageDone(byN(d)))) return 'locked';
  const active = NODES
    .filter((x: any) => !isStageDone(x) && x.deps.every((d: number) => isStageDone(byN(d))))
    .sort((a: any, b: any) => a.n - b.n)[0];
  return active && active.n === n.n ? 'now' : 'next';
}
