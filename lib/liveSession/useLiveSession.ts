'use client';
import { useCallback, useRef, useState } from 'react';
import { initialTranscript, reduceTranscript, type TranscriptState } from './transcript';
import type { SessionEvent } from './parseEvents';
import type { BytePlan } from '../ai/plan';

/** Pure: fold one raw ndjson stream line into the transcript. Each line is an
 *  already-normalized SessionEvent (the server parsed claude's stdout before
 *  emitting), so we JSON.parse it and reduce directly. Returns the SAME reference
 *  when the line is blank or not a valid SessionEvent. */
export function applyLine(state: TranscriptState, line: string): TranscriptState {
  const t = line.trim();
  if (!t) return state;
  let event: SessionEvent;
  try {
    event = JSON.parse(t) as SessionEvent;
  } catch {
    return state;
  }
  if (
    !event ||
    typeof event !== 'object' ||
    typeof (event as { kind?: unknown }).kind !== 'string'
  ) {
    return state;
  }
  return reduceTranscript(state, event);
}

/** Pure: optimistically append the user's own turn and return to running. */
export function applyUserTurn(state: TranscriptState, text: string): TranscriptState {
  return reduceTranscript(state, { kind: 'user-text', text });
}

/** Pure: optimistically clear the pending permission and return to running once the
 *  user has decided (the real proceed/skip arrives as tool events over the stream). */
export function applyDecision(state: TranscriptState): TranscriptState {
  if (!state.pendingPermission) return state;
  const { pendingPermission: _drop, ...rest } = state;
  return { ...rest, status: 'running' };
}

export function useLiveSession(opts: {
  buildSessionId: string;
  projectDir: string;
  plan: BytePlan;
  brief: string;
  mode?: 'suggest' | 'copilot' | 'autopilot';
}) {
  const [state, setState] = useState<TranscriptState>(initialTranscript);
  const started = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(async () => {
    if (started.current) return;
    started.current = true;
    const ac = new AbortController();
    abortRef.current = ac;
    // The whole network sequence is guarded: stop() may abort() the signal mid-flight
    // (component unmount / React strict-mode remount) while either fetch or the stream
    // read is pending. Those reject with AbortError — expected, nothing to surface. The
    // guard must cover the two awaited fetches too, or the AbortError escapes start()'s
    // fire-and-forget promise as an unhandled rejection.
    try {
      const res = await fetch('/api/build-session/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(opts),
        signal: ac.signal,
      });
      if (!res.ok) {
        setState((s) =>
          reduceTranscript(s, { kind: 'error', message: 'Could not start the session here.' }),
        );
        return;
      }
      const stream = await fetch(
        `/api/build-session/stream?buildSessionId=${encodeURIComponent(opts.buildSessionId)}`,
        { signal: ac.signal },
      );
      if (!stream.ok || !stream.body) return;
      const reader = stream.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          setState((s) => applyLine(s, line));
        }
      }
    } catch {
      /* aborted (stop() during startup) or stream closed — nothing to surface */
    }
  }, [opts]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    // Tell the server to kill the persistent claude child. keepalive lets this
    // POST survive component unmount / tab close. Best-effort — ignore failures.
    try {
      fetch('/api/build-session/stop', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ buildSessionId: opts.buildSessionId }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* ignore */
    }
  }, [opts.buildSessionId]);

  const send = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t) return;
      setState((s) => applyUserTurn(s, t));
      try {
        const res = await fetch('/api/build-session/send', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ buildSessionId: opts.buildSessionId, text: t }),
        });
        if (!res.ok) {
          setState((s) =>
            reduceTranscript(s, { kind: 'error', message: 'Could not send that message.' }),
          );
        }
      } catch {
        setState((s) =>
          reduceTranscript(s, { kind: 'error', message: 'Could not send that message.' }),
        );
      }
    },
    [opts.buildSessionId],
  );

  const decide = useCallback(
    async (requestId: string, decision: 'allow' | 'deny') => {
      setState((s) => applyDecision(s));
      try {
        const res = await fetch('/api/build-session/permission', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ buildSessionId: opts.buildSessionId, requestId, decision }),
        });
        if (!res.ok) {
          setState((s) =>
            reduceTranscript(s, { kind: 'error', message: 'Could not send that decision.' }),
          );
        }
      } catch {
        setState((s) =>
          reduceTranscript(s, { kind: 'error', message: 'Could not send that decision.' }),
        );
      }
    },
    [opts.buildSessionId],
  );

  return { state, start, stop, send, decide };
}
