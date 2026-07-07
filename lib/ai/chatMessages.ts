// Pure mapping from byte-chat turns to Claude Messages-API turns. Kept dependency-free
// (no SDK, no 'use client', no 'server-only') so both /api/chat and unit tests import it.

/** One turn of the byte chat. 'me' = the founder, 'byte' = the companion. */
export interface ChatTurn {
  role: 'me' | 'byte';
  text: string;
}

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * How many recent turns byte's chat call carries. The conversation is only ever this many
 * turns deep to the model — byte's real grounding comes from the project model + durable
 * memory (composeProjectModel), not the raw transcript, so older turns are safe to drop.
 * Bounds token cost and keeps a long thread from ever overflowing the context window.
 */
export const MAX_CHAT_TURNS = 20;

/**
 * Map chat turns to Claude messages: 'me' → user, 'byte' → assistant. Empty/whitespace
 * turns are dropped, the history is windowed to the most recent `max` turns, and any
 * leading assistant turns are trimmed, since the Messages API requires the conversation to
 * start with a user turn. Windowing happens BEFORE the leading-assistant trim so a window
 * that begins on a byte turn still yields a valid user-first conversation.
 */
export function toClaudeMessages(history: ChatTurn[], max = MAX_CHAT_TURNS): ClaudeMessage[] {
  const mapped: ClaudeMessage[] = [];
  for (const turn of history) {
    if (!turn || typeof turn.text !== 'string') continue;
    const content = turn.text.trim();
    if (!content) continue;
    mapped.push({ role: turn.role === 'byte' ? 'assistant' : 'user', content });
  }
  const windowed = max > 0 && mapped.length > max ? mapped.slice(-max) : mapped;
  while (windowed.length && windowed[0].role === 'assistant') windowed.shift();
  return windowed;
}
