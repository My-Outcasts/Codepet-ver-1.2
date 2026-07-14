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
  kind: 'start' | 'tool' | 'turn' | 'ask';
  tool?: string;
  /** Byte's narrated line for this turn (already produced locally by the hook). */
  say?: string;
  /** Byte's "Claude is waiting on you" line, on an `ask` event. */
  ask?: string;
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
  /** Byte's most recent narrated line for the DURING bubble. */
  lastSay?: string;
  /** Set while Claude is waiting on the user; cleared when a tool event lands. */
  pendingAsk?: string;
  /** Sum of Claude's per-message usage token counts (local, exact path). */
  tokens?: number;
  /** Real recap stats self-reported by the demo copy-paste command (no toolkit
   *  install required), so remote testers see real commits/files-changed. */
  recap?: DemoRecap;
}

export interface DemoRecap {
  commits: number;
  filesChanged: number;
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

/** Drop keys whose value is undefined — Firestore's Admin SDK rejects undefined
 *  field values, and the live route overwrites the doc with `set` (no merge), so
 *  omitting a key is how we clear it. */
function prune(state: LiveState): LiveState {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(state)) if (v !== undefined) out[k] = v;
  return out as unknown as LiveState;
}

/** Fold one live activity event into the running counters. `start` resets state
 *  (a fresh session), `tool` counts an action (+ records the tool name) and clears
 *  any pending ask, `turn` counts a completed assistant turn (and may update the
 *  narrated line), `ask` records Byte's "waiting on you" line. Always records the
 *  event's session id. Never mutates the input. */
export function reduceLive(state: LiveState | null, event: LiveEvent): LiveState {
  const sessionId = event.sessionId || state?.sessionId || '';
  if (event.kind === 'start') return initialLive(event.ts, sessionId);
  const s = state ?? initialLive(event.ts, sessionId);
  if (event.kind === 'tool') {
    const recentTools = event.tool
      ? [...s.recentTools, event.tool].slice(-RECENT_TOOLS_CAP)
      : s.recentTools;
    // A tool means Claude resumed after any question — clear the pending ask.
    return prune({
      ...s,
      sessionId,
      actionCount: s.actionCount + 1,
      recentTools,
      pendingAsk: undefined,
      lastTs: event.ts,
    });
  }
  if (event.kind === 'ask') {
    return prune({ ...s, sessionId, pendingAsk: event.ask, lastTs: event.ts });
  }
  // kind === 'turn'
  return prune({
    ...s,
    sessionId,
    turns: s.turns + 1,
    lastSay: event.say ?? s.lastSay,
    lastTs: event.ts,
  });
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
    case 'Notification':
      return 'ask';
    default:
      return null;
  }
}

const KINDS = ['start', 'tool', 'turn', 'ask'] as const;

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
  const say =
    kind === 'turn' && typeof r.say === 'string' && r.say.trim()
      ? r.say.trim().slice(0, 160)
      : undefined;
  const ask =
    kind === 'ask' && typeof r.ask === 'string' && r.ask.trim()
      ? r.ask.trim().slice(0, 160)
      : undefined;
  const out: LiveEvent = { buildSessionId, sessionId, kind, ts: Date.now() };
  if (tool !== undefined) out.tool = tool;
  if (say !== undefined) out.say = say;
  if (ask !== undefined) out.ask = ask;
  return out;
}

/** Coerce an untrusted demo-recap body into a clamped {buildSessionId, recap}. Returns
 *  null when the buildSessionId is missing. Numbers are floored, non-negative, capped. */
export function sanitizeDemoRecap(
  raw: unknown,
): { buildSessionId: string; recap: DemoRecap } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const buildSessionId =
    typeof r.buildSessionId === 'string' ? r.buildSessionId.trim().slice(0, 128) : '';
  if (!buildSessionId) return null;
  const int = (v: unknown) => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 100000) : 0;
  };
  return { buildSessionId, recap: { commits: int(r.commits), filesChanged: int(r.filesChanged) } };
}
