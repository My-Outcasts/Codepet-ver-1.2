// Regression guard for the NDJSON switch. /api/run-task streams events now, so EVERY
// caller has to read that framing — not just the run theater. runByteTask is still used
// by the chat run path (store.tsx) and by the department run modal
// (components/artifact/ArtifactModal.tsx); if it tries res.json() on a multi-line NDJSON
// body it throws SyntaxError and running a task breaks everywhere except the theater.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { runByteTask, runByteTaskStreaming } from './runTask';
import { encodeEvent } from './runStream';
import type { RunEvent } from './runTrace';

const ARGS = { kind: 'text' as const, taskTitle: 'Landing site' };

/** The exact wire shape the route emits for a plain-text deliverable. */
const WIRE: RunEvent[] = [
  {
    type: 'step',
    step: {
      phase: 'brief',
      label: 'Read your Business Brief',
      source: 'Brief',
      evidence: [{ quote: 'A macOS companion', source: 'your one-liner' }],
    },
  },
  { type: 'active', phase: 'generate' },
  { type: 'usage', credits: 4 },
  { type: 'step', step: { phase: 'generate', label: 'Writing the deliverable', evidence: [] } },
  { type: 'result', text: 'the finished page' },
];

function ndjsonResponse(events: RunEvent[], chunkSize = 7): Response {
  const wire = events.map(encodeEvent).join('');
  const bytes = new TextEncoder().encode(wire);
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (i >= bytes.length) {
        c.close();
        return;
      }
      // Deliberately tiny chunks: events get split mid-line, like a real network.
      c.enqueue(bytes.slice(i, i + chunkSize));
      i += chunkSize;
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runByteTask against the streaming route', () => {
  it('returns the deliverable from an NDJSON body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ndjsonResponse(WIRE)),
    );
    await expect(runByteTask(ARGS)).resolves.toEqual({ text: 'the finished page' });
  });

  it('still reads a plain JSON body (older deployment / rewritten response)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ text: 'plain' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    await expect(runByteTask(ARGS)).resolves.toEqual({ text: 'plain' });
  });

  it('surfaces a streamed error as GenerateError with the route code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ndjsonResponse([{ type: 'error', code: 'rate_limited' }])),
    );
    await expect(runByteTask(ARGS)).rejects.toMatchObject({
      name: 'GenerateError',
      code: 'rate_limited',
    });
  });

  it('surfaces a non-200 JSON error unchanged', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'unauthorized' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    await expect(runByteTask(ARGS)).rejects.toMatchObject({ code: 'unauthorized' });
  });
});

describe('runByteTaskStreaming', () => {
  it('reports every event in order despite chunk boundaries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ndjsonResponse(WIRE, 5)),
    );
    const seen: RunEvent[] = [];
    const res = await runByteTaskStreaming(ARGS, (ev) => seen.push(ev));
    expect(res).toEqual({ text: 'the finished page' });
    expect(seen).toEqual(WIRE);
  });

  it('synthesises a result event when the body is plain JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ payload: { a: 1 } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    const seen: RunEvent[] = [];
    await runByteTaskStreaming(ARGS, (ev) => seen.push(ev));
    expect(seen).toEqual([{ type: 'result', payload: { a: 1 } }]);
  });
});
