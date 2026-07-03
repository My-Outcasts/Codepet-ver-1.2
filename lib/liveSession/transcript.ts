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
  status: 'running' | 'ended' | 'error';
  messages: Array<{ role: 'assistant'; text: string }>;
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
      return { ...state, messages: [...state.messages, { role: 'assistant', text: event.text }] };
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
      return { ...state, sessionId: event.sessionId || state.sessionId, status: 'ended' };
    case 'error':
      return { ...state, status: 'error', error: event.message };
    case 'exit':
      // A result already succeeded → a trailing exit stays ended.
      if (state.status === 'ended') return state;
      // Any exit while still running (no result yet) or already errored, and any
      // non-zero exit, is a failure. Keep the original error message if we have one.
      return {
        ...state,
        status: 'error',
        error: state.error ?? `claude exited with code ${event.code}`,
      };
    default:
      return state;
  }
}
