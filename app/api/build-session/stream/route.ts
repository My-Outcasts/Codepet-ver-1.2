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
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (e: SessionEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(e) + '\n'));
      // Replay what already happened.
      for (const e of session.buffer) send(e);
      if (session.status !== 'running') {
        controller.close();
        return;
      }
      const onEvent = (e: SessionEvent) => {
        send(e);
        if (e.kind === 'result' || e.kind === 'exit' || e.kind === 'error') {
          session.emitter.off('event', onEvent);
          controller.close();
        }
      };
      session.emitter.on('event', onEvent);
    },
  });

  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' },
  });
}
