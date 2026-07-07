'use client';
import { useEffect, useRef, useState } from 'react';
import { useLiveSession } from '@/lib/liveSession/useLiveSession';
import { describePermission, riskLevel, friendlyTool } from '@/lib/liveSession/permissionSummary';
import type { BytePlan } from '@/lib/ai/plan';

// Session state as a color-coded chip at the top of the live view, so a founder
// glancing over instantly knows whether the build is busy or waiting on them.
const STATE_CHIP: Record<string, { label: string; cls: string }> = {
  running: { label: 'Building…', cls: 'working' },
  'awaiting-input': { label: 'Needs your reply', cls: 'needs' },
  'awaiting-permission': { label: 'Waiting for your OK', cls: 'perm' },
  ended: { label: 'Done', cls: 'done' },
  error: { label: 'Hit a snag', cls: 'snag' },
};

// The Allow/Deny card. Leads with a plain-language risk level + what Byte wants to do
// (the preview IS the confirmation); raw args stay tucked behind Details.
const RISK_LABEL: Record<string, { label: string; hint: string }> = {
  safe: { label: 'Safe', hint: 'just looking — nothing changes' },
  careful: { label: 'Careful', hint: 'this changes a file' },
  risky: { label: 'Risky', hint: 'could remove or overwrite things' },
};

function PermissionCard({
  p,
  onDecide,
}: {
  p: { requestId: string; tool: string; input: unknown };
  onDecide: (requestId: string, decision: 'allow' | 'deny') => void;
}) {
  const risk = riskLevel(p.tool, p.input);
  const r = RISK_LABEL[risk];
  return (
    <div className={`lc-perm risk-${risk}`}>
      <div className="lc-perm-top">
        <span className={`lc-risk ${risk}`}>{r.label}</span>
        <span className="lc-perm-hint">{r.hint}</span>
      </div>
      <div className="lc-perm-q">Byte wants to</div>
      <div className="lc-perm-sum">{describePermission(p.tool, p.input)}</div>
      {p.input != null && (
        <details className="lc-perm-more">
          <summary>Details ({p.tool})</summary>
          <pre className="lc-perm-in">{JSON.stringify(p.input, null, 2).slice(0, 800)}</pre>
        </details>
      )}
      <div className="lc-perm-btns">
        <button className="lc-allow" onClick={() => onDecide(p.requestId, 'allow')}>
          Allow
        </button>
        <button className="lc-deny" onClick={() => onDecide(p.requestId, 'deny')}>
          Deny
        </button>
      </div>
    </div>
  );
}

// Phase 2: two-way live transcript of the real `claude` session. User and assistant
// turns render as chat bubbles; tool activity is listed below; a composer sends
// follow-up turns when the session is awaiting input. See the in-UI session spec.
export function LiveChat({
  buildSessionId,
  projectDir,
  plan,
  brief,
  mode,
}: {
  buildSessionId: string;
  projectDir: string;
  plan: BytePlan;
  brief: string;
  mode: 'suggest' | 'copilot' | 'autopilot';
}) {
  const { state, start, stop, send, decide } = useLiveSession({
    buildSessionId,
    projectDir,
    plan,
    brief,
    mode,
  });
  const [draft, setDraft] = useState('');
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // A pending teardown means this is React strict-mode's immediate remount after a
    // transient unmount — cancel it so we don't kill the just-spawned claude child.
    if (stopTimer.current) {
      clearTimeout(stopTimer.current);
      stopTimer.current = null;
    }
    start();
    return () => {
      // Defer teardown. Strict mode (dev) unmounts then synchronously remounts; a
      // synchronous stop() would kill the claude child that the remount won't respawn
      // (useLiveSession's `started` guard). The next mount clears this timer; a real
      // unmount lets it fire on the next tick.
      stopTimer.current = setTimeout(() => {
        stopTimer.current = null;
        stop();
      }, 0);
    };
  }, [start, stop]);

  const canSend = state.status === 'awaiting-input' && draft.trim().length > 0;
  const submit = () => {
    if (!canSend) return;
    send(draft);
    setDraft('');
  };

  const chip = STATE_CHIP[state.status];
  const active = state.status !== 'ended' && state.status !== 'error';

  return (
    <div className="lc-wrap">
      <div className="lc-head">
        {chip && <span className={`lc-chip ${chip.cls}`}>{chip.label}</span>}
        {active && (
          <button className="lc-stop" onClick={stop} title="Stop the session">
            ⏹ Stop
          </button>
        )}
      </div>
      <div className="lc-feed">
        {state.messages.map((m, i) => (
          <div key={`m${i}`} className={`lc-msg ${m.role}`}>
            {m.text}
          </div>
        ))}
        {state.tools.map((t) => {
          const f = friendlyTool(t.name);
          return (
            <div key={t.id} className={`lc-tool${t.ok === false ? ' err' : ''}`}>
              <span className="lc-tool-ico" aria-hidden="true">
                {f.icon}
              </span>
              <b>{f.verb}</b>
              {t.summary ? <span className="lc-tool-sum"> — {t.summary.slice(0, 120)}</span> : null}
            </div>
          );
        })}
        {state.status === 'running' && <div className="lc-status">Claude is working…</div>}
        {state.status === 'error' && (
          <div className="lc-err">{state.error ?? 'Something went wrong.'}</div>
        )}
      </div>
      {state.pendingPermission && <PermissionCard p={state.pendingPermission} onDecide={decide} />}
      <div className="lc-composer">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder={
            state.status === 'awaiting-input'
              ? 'Reply to Claude…'
              : state.status === 'running'
                ? 'Claude is working — hang on…'
                : 'Session is not active'
          }
          disabled={state.status !== 'awaiting-input'}
        />
        <button className="lc-send" onClick={submit} disabled={!canSend}>
          Send
        </button>
      </div>
    </div>
  );
}
