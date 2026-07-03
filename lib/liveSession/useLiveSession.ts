'use client';
import { useCallback, useRef, useState } from 'react';
import { initialTranscript, reduceTranscript, type TranscriptState } from './transcript';
import { parseEventLine } from './parseEvents';
import type { BytePlan } from '../ai/plan';

/** Pure: fold one raw ndjson stream line (0..n events) into the transcript.
 *  Returns the same reference when the line yields nothing (blank/malformed). */
export function applyLine(state: TranscriptState, line: string): TranscriptState {
  const events = parseEventLine(line);
  if (events.length === 0) return state;
  return events.reduce(reduceTranscript, state);
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
