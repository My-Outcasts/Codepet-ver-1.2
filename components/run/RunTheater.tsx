'use client';
import { useEffect, useState } from 'react';
import { useApp } from '@/lib/store';
import { StepRail } from './StepRail';
import { RunCanvas } from './RunCanvas';

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const PILL: Record<string, { t: string; k: string }> = {
  running: { t: 'Running', k: 'active' },
  done: { t: 'Done', k: 'done' },
  failed: { t: 'Stopped', k: 'fail' },
  limited: { t: 'Paused', k: 'hold' },
};

export function RunTheater() {
  const { liveRun, closeRunTheater, retryRun, approveChatResult, openChatResult } = useApp();
  const [now, setNow] = useState(() => Date.now());
  const status = liveRun?.status;

  // One ticking clock while the run is live; stops the moment it finishes.
  useEffect(() => {
    if (status !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status]);

  if (!liveRun) return null;
  const run = liveRun;
  const pill = PILL[run.status] ?? PILL.running;
  const elapsed = mmss((run.endedAt ?? now) - run.startedAt);

  return (
    <main className="rt">
      <div className="rt-head">
        <button className="rt-back" type="button" onClick={closeRunTheater}>
          ← Back
        </button>
        <div className="rt-id">
          <h2>{run.taskTitle}</h2>
          <div className="rt-eyebrow">
            {run.deptName} · {run.type}
          </div>
        </div>
        <span className="rt-pill" data-k={pill.k}>
          {pill.t} {elapsed}
        </span>
      </div>

      {run.status === 'limited' ? (
        <div className="rt-banner">
          <b>Paused.</b> This workspace is out of AI credits. The finished steps are kept — topping
          up resumes from where it stopped.
        </div>
      ) : null}

      <div className="rt-body">
        <RunCanvas run={run} />
        <StepRail run={run} elapsed={elapsed} />
      </div>

      {run.status === 'done' ? (
        <div className="rt-acts">
          <button
            className="rt-b solid"
            type="button"
            onClick={() => {
              approveChatResult(run.deptK, run.taskTitle);
              closeRunTheater();
            }}
          >
            Approve
          </button>
          <button
            className="rt-b"
            type="button"
            onClick={() => openChatResult(run.deptK, run.taskTitle)}
          >
            Read
          </button>
        </div>
      ) : null}

      {run.status === 'failed' ? (
        <div className="rt-acts">
          <button className="rt-b solid" type="button" onClick={retryRun}>
            Try again
          </button>
          <button className="rt-b" type="button" onClick={closeRunTheater}>
            Leave it for now
          </button>
        </div>
      ) : null}
    </main>
  );
}
