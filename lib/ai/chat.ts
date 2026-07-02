'use client';
// Client side of byte's chat. Streams the reply from /api/chat (which holds the
// Anthropic key) and yields events as they arrive: text chunks (rendered as byte
// types), and — if byte decided to run a task — a single trailing `action` event.
// The server separates the two with a record-separator marker (see ACTION_MARK).
import { authHeader } from './runTask';
import type { ChatTurn } from './chatMessages';

const ACTION_MARK = String.fromCharCode(0x1e);

/** A task byte is allowed to run from chat (sent to the server so it uses real IDs). */
export interface RunnableTask {
  deptK: string;
  deptName: string;
  taskTitle: string;
  hint: string;
}

export type ChatEvent =
  { type: 'text'; text: string } | { type: 'action'; deptK: string; taskTitle: string };

export class ChatError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = 'ChatError';
  }
}

/**
 * Stream byte's reply to the conversation. `history` is the full turn list (including
 * the just-sent user turn); `deptSummary` is a compact snapshot for grounding;
 * `openTasks` are the tasks byte may run from chat. Yields text events; may end with a
 * single `action` event when byte chooses to run a task. Throws ChatError on failure.
 */
export async function* streamByteChat(
  history: ChatTurn[],
  deptSummary?: string,
  openTasks?: RunnableTask[],
): AsyncGenerator<ChatEvent> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ messages: history, deptSummary, openTasks }),
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ChatError(data.error || `http_${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = ''; // holds the action payload once the marker is seen
  let acting = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    const chunk = decoder.decode(value, { stream: true });
    if (acting) {
      // Everything after the marker is the action JSON — accumulate until the end.
      buf += chunk;
      continue;
    }
    const combined = buf + chunk;
    const idx = combined.indexOf(ACTION_MARK);
    if (idx === -1) {
      // No marker yet. RS never appears in prose, so it's safe to emit as text.
      if (combined) yield { type: 'text', text: combined };
      buf = '';
    } else {
      const before = combined.slice(0, idx);
      if (before) yield { type: 'text', text: before };
      buf = combined.slice(idx + ACTION_MARK.length); // start of the action JSON
      acting = true;
    }
  }
  if (acting && buf) {
    try {
      const a = JSON.parse(buf) as { deptK?: unknown; taskTitle?: unknown };
      if (typeof a.deptK === 'string' && typeof a.taskTitle === 'string') {
        yield { type: 'action', deptK: a.deptK, taskTitle: a.taskTitle };
      }
    } catch {
      /* malformed action payload — ignore, byte's text still delivered */
    }
  }
}
