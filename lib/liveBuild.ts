// Pure, framework-free reducer for a live build session's activity counters.
// The /api/track/live endpoint folds each incoming LiveEvent into the stored
// LiveState with reduceLive; the local hook emitter maps a Claude Code hook
// event name to a LiveEvent kind with eventKindFor. No I/O here — unit-tested.
// See docs/superpowers/specs/2026-07-02-build-coach-live-session-design.md.
import type { Millis } from './firebase/schema';

export const RECENT_TOOLS_CAP = 8;

export interface LiveEvent {
  buildSessionId: string;
  sessionId: string;
  kind: 'start' | 'tool' | 'turn';
  tool?: string;
  ts: Millis;
}

export interface LiveState {
  /** Claude Code's session_id — lets END correlate this build to its SessionEnd
   *  rollup (trackEvent), which is keyed by session id, not buildSessionId. */
  sessionId: string;
  actionCount: number;
  turns: number;
  recentTools: string[];
  startedAt: Millis;
  lastTs: Millis;
  ended: boolean;
}

export function initialLive(ts: Millis, sessionId = ''): LiveState {
  return {
    sessionId,
    actionCount: 0,
    turns: 0,
    recentTools: [],
    startedAt: ts,
    lastTs: ts,
    ended: false,
  };
}

/** Fold one live activity event into the running counters. `start` resets state
 *  (a fresh session), `tool` counts an action (+ records the tool name), `turn`
 *  counts a completed assistant turn. Always records the event's session id.
 *  Never mutates the input. */
export function reduceLive(state: LiveState | null, event: LiveEvent): LiveState {
  const sessionId = event.sessionId || state?.sessionId || '';
  if (event.kind === 'start') return initialLive(event.ts, sessionId);
  const s = state ?? initialLive(event.ts, sessionId);
  if (event.kind === 'tool') {
    const recentTools = event.tool
      ? [...s.recentTools, event.tool].slice(-RECENT_TOOLS_CAP)
      : s.recentTools;
    return { ...s, sessionId, actionCount: s.actionCount + 1, recentTools, lastTs: event.ts };
  }
  // kind === 'turn'
  return { ...s, sessionId, turns: s.turns + 1, lastTs: event.ts };
}

/** Map a Claude Code hook event name to the live kind it produces (or null to skip). */
export function eventKindFor(hookEventName: string): LiveEvent['kind'] | null {
  switch (hookEventName) {
    case 'SessionStart':
      return 'start';
    case 'PostToolUse':
      return 'tool';
    case 'Stop':
      return 'turn';
    default:
      return null;
  }
}

const KINDS = ['start', 'tool', 'turn'] as const;

/** Coerce an untrusted request body into a LiveEvent (ts stamped here). Returns
 *  null if either id is missing or the kind is unknown. */
export function sanitizeLiveEvent(raw: unknown): LiveEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const buildSessionId =
    typeof r.buildSessionId === 'string' ? r.buildSessionId.trim().slice(0, 128) : '';
  const sessionId = typeof r.sessionId === 'string' ? r.sessionId.trim().slice(0, 128) : '';
  const kind = KINDS.find((k) => k === r.kind);
  if (!buildSessionId || !sessionId || !kind) return null;
  const tool =
    kind === 'tool' && typeof r.tool === 'string' && r.tool.trim()
      ? r.tool.trim().slice(0, 64)
      : undefined;
  return { buildSessionId, sessionId, kind, tool, ts: Date.now() };
}
