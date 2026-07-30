// NDJSON framing for the run stream. One event per line so the client can render a
// phase the moment its line lands, and so a truncated tail is never mis-parsed.
// Pure and shared by /api/run-task and the client reader — framing is tested once.
import type { RunEvent } from './runTrace';

export function encodeEvent(ev: RunEvent): string {
  return JSON.stringify(ev) + '\n';
}

/** Stateful decoder: feed it raw chunks, get back the events that completed. A partial
 *  trailing line is buffered until its newline arrives. Malformed lines are dropped —
 *  a single bad line must not kill a run the user is watching. */
export function createEventDecoder(): (chunk: string) => RunEvent[] {
  let buffer = '';
  return (chunk: string): RunEvent[] => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    const out: RunEvent[] = [];
    for (const line of lines) {
      const s = line.trim();
      if (!s) continue;
      try {
        out.push(JSON.parse(s) as RunEvent);
      } catch {
        // ignore — a malformed line is dropped, the run continues
      }
    }
    return out;
  };
}
