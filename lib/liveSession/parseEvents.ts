// Pure parser: turn `claude` stream-json stdout into normalized SessionEvents.
// The CLI emits one JSON object per line: {type:'system'|'assistant'|'user'|'result'}.
// An assistant line's message.content may hold several blocks (text + tool_use), so
// one line can yield several events. Never throws — unknown/malformed → [].
// See docs/superpowers/specs/2026-07-03-build-coach-inui-claude-session-design.md.

export type SessionEvent =
  | { kind: 'init'; sessionId: string }
  | { kind: 'assistant-text'; text: string }
  | { kind: 'user-text'; text: string }
  | { kind: 'tool-use'; id: string; name: string; input: unknown }
  | { kind: 'tool-result'; id: string; ok: boolean; summary: string }
  | { kind: 'result'; text: string; sessionId: string }
  | { kind: 'error'; message: string }
  | { kind: 'exit'; code: number | null }
  | { kind: 'permission-request'; requestId: string; tool: string; input: unknown }
  | { kind: 'usage'; tokens: number };

/** Coerce tool_result `content` (string, or an array of text blocks) to a string. */
function resultSummary(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string'
          ? (b as { text: string }).text
          : '',
      )
      .join('')
      .trim();
  }
  return '';
}

export function parseEventLine(line: string): SessionEvent[] {
  const t = line.trim();
  if (!t) return [];
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(t);
  } catch {
    return [];
  }
  if (!obj || typeof obj !== 'object') return [];

  if (obj.type === 'system' && obj.subtype === 'init') {
    return [{ kind: 'init', sessionId: String(obj.session_id ?? '') }];
  }

  if (obj.type === 'result') {
    const text = String(obj.result ?? '');
    // A non-'success' subtype (or an explicit is_error) is a failed turn — surface
    // it as an error so the UI doesn't render "Session finished" on a failure.
    const failed =
      obj.is_error === true || (typeof obj.subtype === 'string' && obj.subtype !== 'success');
    if (failed) {
      return [
        { kind: 'error', message: text || String(obj.subtype ?? 'claude ended with an error') },
      ];
    }
    return [{ kind: 'result', text, sessionId: String(obj.session_id ?? '') }];
  }

  const msg = (obj.message ?? {}) as { content?: unknown };
  const content = Array.isArray(msg.content) ? msg.content : [];

  if (obj.type === 'assistant') {
    const out: SessionEvent[] = [];
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      const block = b as Record<string, unknown>;
      if (block.type === 'text' && typeof block.text === 'string') {
        out.push({ kind: 'assistant-text', text: block.text });
      } else if (block.type === 'tool_use') {
        out.push({
          kind: 'tool-use',
          id: String(block.id ?? ''),
          name: String(block.name ?? ''),
          input: block.input,
        });
      }
    }
    const u = (obj.message as { usage?: Record<string, unknown> } | undefined)?.usage;
    if (u && typeof u === 'object') {
      const n = (k: string) => Number((u as Record<string, unknown>)[k]) || 0;
      const tokens =
        n('input_tokens') +
        n('output_tokens') +
        n('cache_creation_input_tokens') +
        n('cache_read_input_tokens');
      if (tokens > 0) out.push({ kind: 'usage', tokens });
    }
    return out;
  }

  if (obj.type === 'user') {
    const out: SessionEvent[] = [];
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      const block = b as Record<string, unknown>;
      if (block.type === 'tool_result') {
        out.push({
          kind: 'tool-result',
          id: String(block.tool_use_id ?? ''),
          ok: block.is_error !== true,
          summary: resultSummary(block.content),
        });
      }
    }
    return out;
  }

  return [];
}

/** Buffers chunked stdout and emits events for each completed (\n-terminated) line. */
export class StreamParser {
  private buf = '';
  push(chunk: string): SessionEvent[] {
    this.buf += chunk;
    const out: SessionEvent[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      out.push(...parseEventLine(line));
    }
    return out;
  }
}
