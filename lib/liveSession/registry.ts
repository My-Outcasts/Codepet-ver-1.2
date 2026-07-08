// Module-level registry of live `claude` sessions, keyed by buildSessionId. Holds
// the child handle, an event emitter the stream route subscribes to, a replay
// buffer (so a (re)connecting stream sees prior events), and status. Single-user
// local scope — intentionally in-memory and not persisted.
import type { EventEmitter } from 'node:events';
import type { SessionEvent } from './parseEvents';
import type { Autonomy } from './permissionSummary';

export type PermissionDecision = { decision: 'allow' | 'deny'; reason?: string };

export interface LiveSession {
  emitter: EventEmitter;
  child: { stdin: { write(s: string): void; end(): void }; kill(): void };
  status: 'running' | 'ended' | 'error';
  buffer: SessionEvent[];
  pending: Map<string, (d: PermissionDecision) => void>;
  /** Parked codepet_ask questions awaiting the user's answer (null = no answer). */
  pendingAsks: Map<string, (answer: string | null) => void>;
  /** Autonomy level for this session — drives the bridge's auto-approval. */
  mode: Autonomy;
}

const sessions = new Map<string, LiveSession>();

export function getSession(id: string): LiveSession | undefined {
  return sessions.get(id);
}
export function setSession(id: string, s: LiveSession): void {
  sessions.set(id, s);
}
export function deleteSession(id: string): void {
  sessions.delete(id);
}
