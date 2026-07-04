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
  status: 'running' | 'awaiting-input' | 'ended' | 'error';
  messages: Array<{ role: 'user' | 'assistant'; text: string }>;
  tools: ToolActivity[];
  actionCount: number;
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
    case 'tool-use':
      return {
        ...state,
        tools: [...state.tools, { id: event.id, name: event.name, input: event.input }],
        actionCount: state.actionCount + 1,
      };
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
    case 'error':
      return { ...state, status: 'error', error: event.message };
    case 'exit':
      // The process is gone. A clean exit ends the session; anything else is an
      // error. Never overwrite an error we already recorded.
      if (state.status === 'error') return state;
      return event.code === 0
        ? { ...state, status: 'ended' }
        : {
            ...state,
            status: 'error',
            error: state.error ?? `claude exited with code ${event.code}`,
          };
    default:
      return state;
  }
}
