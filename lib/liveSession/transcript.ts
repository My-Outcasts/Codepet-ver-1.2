// Pure reducer: fold SessionEvents into the chat view model the DuringStep renders.
// Never mutates its input. actionCount = number of tool invocations (feeds Byte's
// budget meter). See the in-UI Claude session design spec.
import type { SessionEvent } from './parseEvents';

export interface ToolActivity {
  id: string;
  name: string;
  input: unknown;
  ok?: boolean;
  summary?: string;
}

export interface TranscriptState {
  sessionId?: string;
  status:
    'running' | 'awaiting-input' | 'awaiting-permission' | 'awaiting-question' | 'ended' | 'error';
  messages: Array<{ role: 'user' | 'assistant'; text: string }>;
  tools: ToolActivity[];
  actionCount: number;
  pendingPermission?: { requestId: string; tool: string; input: unknown };
  /** A codepet_ask question waiting on the founder (answer via chips or composer). */
  pendingQuestion?: { requestId: string; question: string; options?: string[] };
  error?: string;
}

export function initialTranscript(): TranscriptState {
  return { status: 'running', messages: [], tools: [], actionCount: 0 };
}

export function reduceTranscript(state: TranscriptState, event: SessionEvent): TranscriptState {
  // Any event other than a NEW permission-request/question resolves/supersedes the
  // matching pending card (allow → tool-use, answer → the model continues with
  // text/result). Dropping them here also stops a stale, already-resolved card
  // from reappearing when the buffer is replayed to a reconnecting client.
  let base: TranscriptState = state;
  if (event.kind !== 'permission-request' && base.pendingPermission) {
    const { pendingPermission: _drop, ...rest } = base;
    base = rest;
  }
  if (event.kind !== 'question' && base.pendingQuestion) {
    const { pendingQuestion: _drop, ...rest } = base;
    base = rest;
  }
  switch (event.kind) {
    case 'init':
      return { ...base, sessionId: event.sessionId };
    case 'assistant-text':
      return {
        ...base,
        status: 'running',
        messages: [...base.messages, { role: 'assistant', text: event.text }],
      };
    case 'user-text':
      return {
        ...base,
        status: 'running',
        messages: [...base.messages, { role: 'user', text: event.text }],
      };
    case 'tool-use':
      return {
        ...base,
        status: 'running',
        tools: [...base.tools, { id: event.id, name: event.name, input: event.input }],
        actionCount: base.actionCount + 1,
      };
    case 'tool-result':
      return {
        ...base,
        tools: base.tools.map((t) =>
          t.id === event.id ? { ...t, ok: event.ok, summary: event.summary } : t,
        ),
      };
    case 'permission-request':
      return {
        ...base,
        status: 'awaiting-permission',
        pendingPermission: { requestId: event.requestId, tool: event.tool, input: event.input },
      };
    case 'question':
      return {
        ...base,
        status: 'awaiting-question',
        pendingQuestion: {
          requestId: event.requestId,
          question: event.question,
          ...(event.options && event.options.length > 0 ? { options: event.options } : {}),
        },
      };
    case 'result':
      return { ...base, sessionId: event.sessionId || base.sessionId, status: 'awaiting-input' };
    case 'error':
      return { ...base, status: 'error', error: event.message };
    case 'exit':
      if (base.status === 'error') return base;
      return event.code === 0
        ? { ...base, status: 'ended' }
        : {
            ...base,
            status: 'error',
            error: base.error ?? `claude exited with code ${event.code}`,
          };
    default:
      return base;
  }
}
