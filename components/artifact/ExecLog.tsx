'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LogStep } from '@/lib/helpers';

// Shared by the deliverable modal and the inline chat card. A run's steps stream in one
// by one with a "Ran N actions" counter; onDone fires once the log has played through.
// Under prefers-reduced-motion the whole log shows at once.
export function ExecLog({
  steps,
  title,
  onDone,
}: {
  steps: LogStep[];
  title: ReactNode;
  onDone: () => void;
}) {
  const [shown, setShown] = useState(0);
  const [complete, setComplete] = useState(false);
  const actions = useRef(0);
  const [actionCount, setActionCount] = useState(0);

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      const total = steps.reduce((a, s) => a + 3 + ((s.t || s.ck || '').length % 6), 0);
      setActionCount(total);
      setShown(steps.length);
      setComplete(true);
      const t = setTimeout(onDone, 40);
      return () => clearTimeout(t);
    }
    setShown(0);
    setComplete(false);
    actions.current = 0;
    setActionCount(0);
    let i = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const tick = () => {
      if (i < steps.length) {
        const s = steps[i];
        actions.current += 3 + ((s.t || s.ck || '').length % 6);
        setActionCount(actions.current);
        i++;
        setShown(i);
        timers.push(setTimeout(tick, s.ck ? 700 : s.mono ? 340 : 520));
      } else {
        setComplete(true);
        timers.push(setTimeout(onDone, 320));
      }
    };
    timers.push(setTimeout(tick, 40));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps]);

  return (
    <div className="exec">
      <div className="exec-h">
        <span className="spin" />
        <span>{title}</span>
        <span className="ec">Ran {actionCount} actions</span>
      </div>
      <div className="exec-log">
        {steps.slice(0, shown).map((s, i) => {
          const live = i === shown - 1 && !complete;
          if (s.ck)
            return (
              <div className="exec-ck" key={i}>
                <span className="ckd" />
                <span>{s.ck}</span>
              </div>
            );
          if (s.mono)
            return (
              <div className={`wrow mono${live ? ' live' : ''}`} key={i}>
                <span className="wk tk0">›</span>
                <span className="wm" dangerouslySetInnerHTML={{ __html: s.t || '' }} />
              </div>
            );
          return (
            <div className={`wrow${live ? ' live' : ''}`} key={i}>
              <span className="wk">{live ? '' : '✓'}</span>
              <span>{s.t}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The finished log as a static record (all steps ✓, no animation / spinner / header) —
// used by the inline card's "What byte did" toggle.
export function StaticLog({ steps }: { steps: LogStep[] }) {
  return (
    <div className="exec-log static">
      {steps.map((s, i) => {
        if (s.ck)
          return (
            <div className="exec-ck" key={i}>
              <span className="ckd" />
              <span>{s.ck}</span>
            </div>
          );
        if (s.mono)
          return (
            <div className="wrow mono" key={i}>
              <span className="wk tk0">›</span>
              <span className="wm" dangerouslySetInnerHTML={{ __html: s.t || '' }} />
            </div>
          );
        return (
          <div className="wrow" key={i}>
            <span className="wk">✓</span>
            <span>{s.t}</span>
          </div>
        );
      })}
    </div>
  );
}
