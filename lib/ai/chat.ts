'use client';
// Client side of byte's chat. Streams the reply from /api/chat (which holds the
// Anthropic key) and yields text chunks as they arrive, so the UI can render byte's
// answer as it types. Attaches the signed-in user's Firebase ID token.
import { authHeader } from './runTask';
import type { ChatTurn } from './chatMessages';

export class ChatError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = 'ChatError';
  }
}

/**
 * Stream byte's reply to the conversation. `history` is the full turn list (including
 * the just-sent user turn); `deptSummary` is a compact, plain-text snapshot of the
 * company's departments for grounding. Yields text chunks; throws ChatError on failure.
 */
export async function* streamByteChat(
  history: ChatTurn[],
  deptSummary?: string,
): AsyncGenerator<string> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ messages: history, deptSummary }),
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ChatError(data.error || `http_${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) yield decoder.decode(value, { stream: true });
  }
}
