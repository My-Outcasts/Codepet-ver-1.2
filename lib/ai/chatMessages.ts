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
 * Map chat turns to Claude messages: 'me' → user, 'byte' → assistant. Empty/whitespace
 * turns are dropped, and any leading assistant turns are trimmed, since the Messages API
 * requires the conversation to start with a user turn.
 */
export function toClaudeMessages(history: ChatTurn[]): ClaudeMessage[] {
  const mapped: ClaudeMessage[] = [];
  for (const turn of history) {
    if (!turn || typeof turn.text !== 'string') continue;
    const content = turn.text.trim();
    if (!content) continue;
    mapped.push({ role: turn.role === 'byte' ? 'assistant' : 'user', content });
  }
  while (mapped.length && mapped[0].role === 'assistant') mapped.shift();
  return mapped;
}
