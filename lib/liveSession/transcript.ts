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
  status: 'running' | 'awaiting-input' | 'awaiting-permission' | 'ended' | 'error';
  messages: Array<{ role: 'user' | 'assistant'; text: string }>;
  tools: ToolActivity[];
  actionCount: number;
  pendingPermission?: { requestId: string; tool: string; input: unknown };
  error?: string;
}

export function initialTranscript(): TranscriptState {
  return { status: 'running', messages: [], tools: [], actionCount: 0 };
}

export function reduceTranscript(state: TranscriptState, event: SessionEvent): TranscriptState {
  switch (event.kind) {
    case 'init':
      return { ...state, sessionId: event.sessionId };
    case 'assistant-text':
      return {
        ...state,
        status: 'running',
        messages: [...state.messages, { role: 'assistant', text: event.text }],
      };
    case 'user-text':
      return {
        ...state,
        status: 'running',
        messages: [...state.messages, { role: 'user', text: event.text }],
      };
    case 'tool-use': {
      const { pendingPermission: _drop, ...rest } = state;
      return {
        ...rest,
        status: 'running',
        tools: [...state.tools, { id: event.id, name: event.name, input: event.input }],
        actionCount: state.actionCount + 1,
      };
    }
    case 'tool-result':
      return {
        ...state,
        tools: state.tools.map((t) =>
          t.id === event.id ? { ...t, ok: event.ok, summary: event.summary } : t,
        ),
      };
    case 'result':
      // A turn finished — the session stays alive, waiting for the next user turn.
      return { ...state, sessionId: event.sessionId || state.sessionId, status: 'awaiting-input' };
    case 'permission-request':
      return {
        ...state,
        status: 'awaiting-permission',
        pendingPermission: { requestId: event.requestId, tool: event.tool, input: event.input },
      };
    case 'error': {
      const { pendingPermission: _d, ...rest } = state;
      return { ...rest, status: 'error', error: event.message };
    }
    case 'exit': {
      const { pendingPermission: _d, ...rest } = state;
      if (rest.status === 'error') return { ...rest, pendingPermission: undefined } as TranscriptState;
      return event.code === 0
        ? { ...rest, status: 'ended' }
        : { ...rest, status: 'error', error: rest.error ?? `claude exited with code ${event.code}` };
    }
    default:
      return state;
  }
}
