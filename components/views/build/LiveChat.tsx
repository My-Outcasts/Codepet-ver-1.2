'use client';
import { useEffect } from 'react';
import { useLiveSession } from '@/lib/liveSession/useLiveSession';
import type { BytePlan } from '@/lib/ai/plan';

// Phase 1: read-only live transcript of the real `claude` session — assistant text
// and tool activity, streamed into the UI. Composer + permission prompts are later
// phases. See the in-UI Claude session design spec.
export function LiveChat({
  buildSessionId,
  projectDir,
  plan,
  brief,
}: {
  buildSessionId: string;
  projectDir: string;
  plan: BytePlan;
  brief: string;
}) {
  const { state, start } = useLiveSession({ buildSessionId, projectDir, plan, brief });

  useEffect(() => {
    start();
  }, [start]);

  return (
    <div className="lc-wrap">
      <div className="lc-feed">
        {state.messages.map((m, i) => (
          <div key={`m${i}`} className="lc-msg">
            {m.text}
          </div>
        ))}
        {state.tools.map((t) => (
          <div key={t.id} className={`lc-tool${t.ok === false ? ' err' : ''}`}>
            <b>{t.name}</b>
            {t.summary ? <span className="lc-tool-sum"> — {t.summary.slice(0, 120)}</span> : null}
          </div>
        ))}
        {state.status === 'error' && (
          <div className="lc-err">{state.error ?? 'Something went wrong.'}</div>
        )}
        {state.status === 'ended' && <div className="lc-done">Session finished.</div>}
      </div>
    </div>
  );
}
