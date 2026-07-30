'use client';
// Client side of byte's chat. Streams the reply from /api/chat (which holds the
// Anthropic key) and yields events as they arrive: text chunks (rendered as byte
// types), and — if byte decided to run a task — a single trailing `action` event.
// The server separates the two with a record-separator marker (see ACTION_MARK).
import { authHeader } from './runTask';
import type { ChatTurn } from './chatMessages';
import type { SetupItem } from './envSetup';

const ACTION_MARK = String.fromCharCode(0x1e);
const BUILD_MARK = String.fromCharCode(0x1d);
// Marker (file-separator, U+001C) that signals a mid-stream failure. Carries a trailing
// JSON `{ code }` payload — mirrors ACTION_MARK's wire shape so a credit outage or
// upstream error mid-reply throws an honest ChatError instead of surfacing as the
// generic network-failure message.
const ERROR_MARK = String.fromCharCode(0x1c);

/** A task byte is allowed to run from chat (sent to the server so it uses real IDs). */
export interface RunnableTask {
  deptK: string;
  deptName: string;
  taskTitle: string;
  hint: string;
}

export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'action'; deptK: string; taskTitle: string }
  | { type: 'build-offer' }
  | { type: 'nav'; dest: string; target?: string }
  | { type: 'setup'; category: string; name: string }
  | { type: 'noted'; items: { topic: string; statement: string }[] };

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
  envSetup?: SetupItem[],
  focusDeptKey?: string,
  threadSummary?: string,
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({
      messages: history,
      deptSummary,
      openTasks,
      envSetup,
      focusDeptKey,
      threadSummary,
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ChatError(data.error || `http_${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = ''; // holds the action/error payload once ACTION_MARK/ERROR_MARK is seen
  let acting = false; // inside the ACTION_MARK JSON payload
  let erroring = false; // inside the ERROR_MARK JSON payload
  let offered = false; // BUILD_MARK seen — nothing meaningful follows
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    const chunk = decoder.decode(value, { stream: true });
    if (acting) {
      buf += chunk; // everything after ACTION_MARK is the action JSON
      continue;
    }
    if (erroring) {
      buf += chunk; // everything after ERROR_MARK is the error JSON
      continue;
    }
    if (offered) continue; // a build offer ends the meaningful stream
    const combined = buf + chunk;
    const aIdx = combined.indexOf(ACTION_MARK);
    const bIdx = combined.indexOf(BUILD_MARK);
    const eIdx = combined.indexOf(ERROR_MARK);
    // Earliest present marker wins (-1 = absent, filtered out).
    const firstIdx = [aIdx, bIdx, eIdx].filter((i) => i !== -1).sort((x, y) => x - y)[0];
    if (firstIdx === undefined) {
      // No marker yet. RS/GS/FS never appear in prose, so it's safe to emit as text.
      if (combined) yield { type: 'text', text: combined };
      buf = '';
    } else if (firstIdx === bIdx) {
      const before = combined.slice(0, bIdx);
      if (before) yield { type: 'text', text: before };
      yield { type: 'build-offer' };
      offered = true;
      buf = '';
    } else if (firstIdx === eIdx) {
      const before = combined.slice(0, eIdx);
      if (before) yield { type: 'text', text: before };
      buf = combined.slice(eIdx + ERROR_MARK.length); // start of the error JSON
      erroring = true;
    } else {
      const before = combined.slice(0, aIdx);
      if (before) yield { type: 'text', text: before };
      buf = combined.slice(aIdx + ACTION_MARK.length); // start of the action JSON
      acting = true;
    }
  }
  if (erroring) {
    let code = 'ai_unavailable';
    try {
      const e = JSON.parse(buf) as { code?: unknown };
      if (typeof e.code === 'string' && e.code) code = e.code;
    } catch {
      /* keep the default */
    }
    throw new ChatError(code);
  }
  if (acting && buf) {
    try {
      const a = JSON.parse(buf) as {
        deptK?: unknown;
        taskTitle?: unknown;
        nav?: unknown;
        target?: unknown;
        setup?: unknown;
        noted?: unknown;
        offerBuild?: unknown;
      };
      // The action tools are mutually exclusive; memory (noted) is orthogonal and may
      // accompany any of them, so it's yielded independently of the action branch.
      if (typeof a.deptK === 'string' && typeof a.taskTitle === 'string') {
        yield { type: 'action', deptK: a.deptK, taskTitle: a.taskTitle };
      } else if (typeof a.nav === 'string') {
        yield {
          type: 'nav',
          dest: a.nav,
          target: typeof a.target === 'string' ? a.target : undefined,
        };
      } else if (a.setup && typeof a.setup === 'object') {
        const s = a.setup as { category?: unknown; name?: unknown };
        if (typeof s.category === 'string' && typeof s.name === 'string') {
          yield { type: 'setup', category: s.category, name: s.name };
        }
      }
      if (Array.isArray(a.noted)) {
        const items = a.noted
          .map((n) => n as { topic?: unknown; statement?: unknown })
          .filter(
            (n): n is { topic: string; statement: string } =>
              typeof n.topic === 'string' && typeof n.statement === 'string',
          )
          .map((n) => ({ topic: n.topic, statement: n.statement }));
        if (items.length) yield { type: 'noted', items };
      }
      // A build offer folded into the action mark (byte captured a fact AND offered to build in
      // one turn). Orthogonal to the action/noted branches, so yield it independently.
      if (a.offerBuild === true) yield { type: 'build-offer' };
    } catch {
      /* malformed action payload — ignore, byte's text still delivered */
    }
  }
}

/**
 * Fold a batch of scrolled-off turns into the thread's rolling summary via
 * /api/summarize-thread. Best-effort: any failure returns null and the caller keeps the
 * prior summary (long-thread memory just doesn't advance this round).
 */
export async function summarizeThread(
  priorSummary: string,
  turns: ChatTurn[],
): Promise<string | null> {
  try {
    const res = await fetch('/api/summarize-thread', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ priorSummary, turns }),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { summary?: unknown };
    return typeof data.summary === 'string' ? data.summary : null;
  } catch {
    return null;
  }
}
