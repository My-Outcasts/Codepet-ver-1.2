// Pure (de)serialization for the active "Let's build" session, so a page reload
// doesn't orphan a running build. The store saves this blob to localStorage on arm
// and on every build-state change, restores it on mount (same company only), and the
// live view re-attaches to the server's replay buffer via `resume`. No I/O here —
// the storage read/write stays in the store. See the in-UI Claude session design spec.
import type { BytePlan } from './ai/plan';
import type { LiveState } from './liveBuild';
import type { BuildStep } from './buildFlow';

export const ACTIVE_BUILD_KEY = 'codepet:active-build';
const VERSION = 1;

export interface ActiveBuildSnapshot {
  v: typeof VERSION;
  companyId: string;
  buildSessionId: string;
  step: BuildStep;
  project: string;
  projectDir: string;
  brief: string;
  plan: BytePlan;
  autonomy: 'suggest' | 'copilot' | 'autopilot';
  local: boolean;
  launchCommand: string | null;
  checkpoint: { ref: string } | null;
  /** Last live reading, so the recap keeps its numbers across a reload. */
  live: LiveState | null;
}

export function serializeActiveBuild(snap: Omit<ActiveBuildSnapshot, 'v'>): string {
  return JSON.stringify({ v: VERSION, ...snap });
}

const AUTONOMY = new Set(['suggest', 'copilot', 'autopilot']);
const STEPS = new Set(['during', 'end']);

/** Parse a stored snapshot; null for garbage, wrong version, or another company's
 *  build (a shared browser must never resurrect someone else's session). */
export function parseActiveBuild(
  raw: string | null,
  companyId: string,
): ActiveBuildSnapshot | null {
  if (!raw) return null;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object') return null;
  const s = o as Record<string, unknown>;
  if (
    s.v !== VERSION ||
    s.companyId !== companyId ||
    typeof s.buildSessionId !== 'string' ||
    !s.buildSessionId ||
    typeof s.brief !== 'string' ||
    typeof s.project !== 'string' ||
    typeof s.projectDir !== 'string' ||
    typeof s.local !== 'boolean' ||
    !STEPS.has(s.step as string) ||
    !AUTONOMY.has(s.autonomy as string) ||
    !s.plan ||
    typeof s.plan !== 'object' ||
    !Array.isArray((s.plan as { steps?: unknown }).steps)
  ) {
    return null;
  }
  return s as unknown as ActiveBuildSnapshot;
}
