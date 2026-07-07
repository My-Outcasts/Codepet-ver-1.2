// Long-lived stream of a live session's events to the browser as newline-delimited
// JSON (same transport style as /api/chat). Replays the buffered events on connect
// so a (re)connection resumes, then forwards new events until the session ends.
import { getSession } from '@/lib/liveSession/registry';
import type { SessionEvent } from '@/lib/liveSession/parseEvents';

export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get('buildSessionId') ?? '';
  const session = getSession(id);
  if (!session) {
    return new Response(JSON.stringify({ error: 'no such session' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  let onEvent: ((e: SessionEvent) => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeSend = (e: SessionEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + '\n'));
        } catch {
          closed = true;
        }
      };
      // Replay what already happened.
      for (const e of session.buffer) safeSend(e);
      if (session.status !== 'running') {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        return;
      }
      onEvent = (e: SessionEvent) => {
        safeSend(e);
        if (e.kind === 'exit' || e.kind === 'error') {
          if (onEvent) session.emitter.off('event', onEvent);
          onEvent = null;
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      };
      session.emitter.on('event', onEvent);
    },
    cancel() {
      if (onEvent) {
        session.emitter.off('event', onEvent);
        onEvent = null;
      }
    },
  });

  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' },
  });
}
