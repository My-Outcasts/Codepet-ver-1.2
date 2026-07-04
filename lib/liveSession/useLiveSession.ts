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

export function useLiveSession(opts: {
  buildSessionId: string;
  projectDir: string;
  plan: BytePlan;
  brief: string;
}) {
  const [state, setState] = useState<TranscriptState>(initialTranscript);
  const started = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(async () => {
    if (started.current) return;
    started.current = true;
    const ac = new AbortController();
    abortRef.current = ac;
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
    try {
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
      /* aborted or stream closed */
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

  return { state, start, stop, send };
}
