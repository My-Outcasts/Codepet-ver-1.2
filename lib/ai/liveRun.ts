// The state a founder is watching while a task runs. A pure reducer over the events
// /api/run-task streams, so the theater's behaviour (what stays on screen when a run
// fails, when the spinner clears) is unit-tested without React.
import type { RunEvent, RunPhase, RunStep } from './runTrace';

export type RunStatus = 'running' | 'done' | 'failed' | 'limited';

export interface LiveRun {
  deptK: string;
  taskTitle: string;
  deptName: string;
  /** Deliverable type (artType) — drives the canvas outline. */
  type: string;
  status: RunStatus;
  /** Steps that actually completed, in the order they completed. */
  steps: RunStep[];
  activePhase: RunPhase | null;
  donePhases: RunPhase[];
  /** Real credits charged for this run; null until the server reports it. */
  credits: number | null;
  startedAt: number;
  endedAt: number | null;
  errorCode: string | null;
  result: { text?: string; payload?: unknown } | null;
}

export function newRun(init: {
  deptK: string;
  taskTitle: string;
  deptName: string;
  type: string;
  startedAt: number;
}): LiveRun {
  return {
    ...init,
    status: 'running',
    steps: [],
    activePhase: null,
    donePhases: [],
    credits: null,
    endedAt: null,
    errorCode: null,
    result: null,
  };
}

export function isFinished(state: LiveRun): boolean {
  return state.status !== 'running';
}

export function reduceRun(state: LiveRun, ev: RunEvent, now: number): LiveRun {
  // A finished run is immutable — a late event must never reopen it or overwrite a result.
  if (isFinished(state)) return state;
  switch (ev.type) {
    case 'step':
      return {
        ...state,
        steps: [...state.steps, ev.step],
        donePhases: [...state.donePhases, ev.step.phase],
        // Only the phase that just completed stops being active.
        activePhase: state.activePhase === ev.step.phase ? null : state.activePhase,
      };
    case 'active':
      return { ...state, activePhase: ev.phase };
    case 'usage':
      return { ...state, credits: ev.credits };
    case 'result':
      return {
        ...state,
        status: 'done',
        result: { text: ev.text, payload: ev.payload },
        activePhase: null,
        endedAt: now,
      };
    case 'error':
      return {
        ...state,
        status: ev.code === 'rate_limited' || ev.code === 'http_429' ? 'limited' : 'failed',
        errorCode: ev.code,
        activePhase: null,
        endedAt: now,
      };
  }
}
