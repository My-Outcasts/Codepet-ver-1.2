'use client';
import { useState, type ReactNode } from 'react';
import type { LiveRun } from '@/lib/ai/liveRun';
import type { RunPhase } from '@/lib/ai/runTrace';

// Every phase the run can pass through, in order, with the label shown BEFORE the
// server has reported that phase. Once a real step arrives it replaces the label with
// the server's own words — pending rows are the only text not sourced from the run.
const PENDING: ReadonlyArray<[RunPhase, string]> = [
  ['brief', 'Read your Business Brief'],
  ['prior', 'Check your approved work'],
  ['generate', 'Write the deliverable'],
];

type Glyph = 'done' | 'active' | 'pending' | 'fail' | 'hold';

function Row({
  glyph,
  label,
  source,
  children,
  onToggle,
  open,
}: {
  glyph: Glyph;
  label: string;
  source?: string;
  children?: ReactNode;
  onToggle?: () => void;
  open?: boolean;
}) {
  return (
    <div className="rt-step" data-s={glyph} aria-expanded={children ? open : undefined}>
      <button className="rt-step-row" type="button" onClick={onToggle} disabled={!children}>
        <span className="rt-g" aria-hidden="true" />
        <span className="rt-step-t">{label}</span>
        {source ? <span className="rt-src">{source}</span> : <span />}
        {children ? <span className="rt-caret" aria-hidden="true" /> : <span />}
      </button>
      {children && open ? <div className="rt-ev">{children}</div> : null}
    </div>
  );
}

export function StepRail({ run, elapsed }: { run: LiveRun; elapsed: string }) {
  const [open, setOpen] = useState<RunPhase | null>(null);
  const done = new Map(run.steps.map((s) => [s.phase, s]));

  return (
    <aside className="rt-rail" aria-label="What the agent is doing">
      <div className="rt-rail-h">What {run.deptName} is doing</div>
      <div className="rt-steps">
        {PENDING.map(([phase, fallback]) => {
          const step = done.get(phase);
          const failedHere = run.status === 'failed' && !step && phase === 'generate';
          const glyph: Glyph = step
            ? 'done'
            : run.activePhase === phase
              ? 'active'
              : failedHere
                ? 'fail'
                : run.status === 'limited' && phase === 'generate'
                  ? 'hold'
                  : 'pending';
          return (
            <Row
              key={phase}
              glyph={glyph}
              label={step ? step.label : fallback}
              source={step?.source}
              open={open === phase}
              onToggle={
                step?.evidence.length ? () => setOpen(open === phase ? null : phase) : undefined
              }
            >
              {step?.evidence.length
                ? step.evidence.map((e, i) => (
                    <div className="rt-ev-i" key={i}>
                      <q>{e.quote}</q>
                      <em>{e.source}</em>
                    </div>
                  ))
                : null}
            </Row>
          );
        })}
      </div>
      <div className="rt-rail-f">
        <span>{elapsed} elapsed</span>
        <span className="rt-dot">·</span>
        <span>{run.credits === null ? 'cost pending' : `${run.credits} credits for this run`}</span>
      </div>
    </aside>
  );
}
