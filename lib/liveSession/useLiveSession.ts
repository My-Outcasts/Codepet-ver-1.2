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

export function useLiveSession(opts: {
  buildSessionId: string;
  projectDir: string;
  plan: BytePlan;
  brief: string;
}) {
  const [state, setState] = useState<TranscriptState>(initialTranscript);
  const started = useRef(false);

  const start = useCallback(async () => {
    if (started.current) return;
    started.current = true;
    const res = await fetch('/api/build-session/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(opts),
    });
    if (!res.ok) {
      setState((s) =>
        reduceTranscript(s, { kind: 'error', message: 'Could not start the session here.' }),
      );
      return;
    }
    const stream = await fetch(
      `/api/build-session/stream?buildSessionId=${encodeURIComponent(opts.buildSessionId)}`,
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
  }, [opts]);

  return { state, start };
}
