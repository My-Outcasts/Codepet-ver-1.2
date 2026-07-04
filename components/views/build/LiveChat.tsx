'use client';
import { useEffect, useState } from 'react';
import { useLiveSession } from '@/lib/liveSession/useLiveSession';
import type { BytePlan } from '@/lib/ai/plan';

// Phase 2: two-way live transcript of the real `claude` session. User and assistant
// turns render as chat bubbles; tool activity is listed below; a composer sends
// follow-up turns when the session is awaiting input. See the in-UI session spec.
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
  const { state, start, stop, send, decide } = useLiveSession({
    buildSessionId,
    projectDir,
    plan,
    brief,
  });
  const [draft, setDraft] = useState('');

  useEffect(() => {
    start();
    return () => stop();
  }, [start, stop]);

  const canSend = state.status === 'awaiting-input' && draft.trim().length > 0;
  const submit = () => {
    if (!canSend) return;
    send(draft);
    setDraft('');
  };

  return (
    <div className="lc-wrap">
      <div className="lc-feed">
        {state.messages.map((m, i) => (
          <div key={`m${i}`} className={`lc-msg ${m.role}`}>
            {m.text}
          </div>
        ))}
        {state.tools.map((t) => (
          <div key={t.id} className={`lc-tool${t.ok === false ? ' err' : ''}`}>
            <b>{t.name}</b>
            {t.summary ? <span className="lc-tool-sum"> — {t.summary.slice(0, 120)}</span> : null}
          </div>
        ))}
        {state.status === 'running' && <div className="lc-status">Claude is working…</div>}
        {state.status === 'awaiting-permission' && (
          <div className="lc-status">Waiting for your Allow / Deny…</div>
        )}
        {state.status === 'error' && (
          <div className="lc-err">{state.error ?? 'Something went wrong.'}</div>
        )}
        {state.status === 'ended' && <div className="lc-done">Session finished.</div>}
      </div>
      {state.pendingPermission && (
        <div className="lc-perm">
          <div className="lc-perm-q">
            Claude wants to use <b>{state.pendingPermission.tool}</b>
          </div>
          <pre className="lc-perm-in">
            {JSON.stringify(state.pendingPermission.input, null, 2).slice(0, 400)}
          </pre>
          <div className="lc-perm-btns">
            <button
              className="lc-allow"
              onClick={() => decide(state.pendingPermission!.requestId, 'allow')}
            >
              Allow
            </button>
            <button
              className="lc-deny"
              onClick={() => decide(state.pendingPermission!.requestId, 'deny')}
            >
              Deny
            </button>
          </div>
        </div>
      )}
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
