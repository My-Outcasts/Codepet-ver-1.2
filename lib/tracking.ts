// Aggregation of real Claude Code activity into the numbers the Summary shows.
// Pure and framework-free so it's trivially unit-tested; the persistence layer
// (companyData) feeds it TrackEvents read from Firestore, and the SummaryView
// renders the result. See docs/superpowers/specs/2026-07-01-claude-code-tracking.
import type { Millis } from './firebase/schema';

/** One session-end rollup pushed by the local SessionEnd hook (see /api/track). */
export interface TrackEvent {
  id: string;
  ts: Millis; // session end time
  sessionId: string;
  cwd?: string;
  repo?: string;
  branch?: string;
  commits: number;
  prs: number;
  linesAdded: number;
  linesRemoved: number;
  /** Commit subjects from the session — the raw material for "Recent wins". */
  wins: string[];
}

export interface RecentWin {
  title: string;
  repo?: string;
  ts: Millis;
}

export interface TrackingSummary {
  sessions: number;
  commits: number;
  prs: number;
  linesChanged: number;
  hoursSaved: number;
  recentWins: RecentWin[];
}

export const EMPTY_TRACKING: TrackingSummary = {
  sessions: 0,
  commits: 0,
  prs: 0,
  linesChanged: 0,
  hoursSaved: 0,
  recentWins: [],
};

const MAX_WINS = 3;

// Transparent heuristic — a directionally-honest proxy, NOT a measurement. The UI
// labels it "est.". Constants are here so they're easy to tune.
const LINES_PER_HOUR = 150; // hand-writing throughput a founder would otherwise spend
const HOURS_PER_COMMIT = 0.4;
const HOURS_PER_SESSION = 0.3;

export function estimateHoursSaved(input: {
  linesChanged: number;
  commits: number;
  sessions: number;
}): number {
  const raw =
    input.linesChanged / LINES_PER_HOUR +
    input.commits * HOURS_PER_COMMIT +
    input.sessions * HOURS_PER_SESSION;
  return Math.round(raw);
}

const MAX_PROJECTS = 12;

/** The project a session ran in: its git repo name, or the last folder of its
 *  working directory. Null when the session reported neither. */
function projectName(e: TrackEvent): string | null {
  if (e.repo) return e.repo;
  if (e.cwd) {
    const parts = e.cwd.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? null;
  }
  return null;
}

/** Distinct local projects the tracker has seen, newest-first, deduped, capped.
 *  Feeds the Build Coach's "Which project?" picker. */
export function distinctProjects(events: TrackEvent[], max = MAX_PROJECTS): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of [...events].sort((a, b) => b.ts - a.ts)) {
    const name = projectName(e);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= max) break;
  }
  return out;
}

/** Roll a list of session events up into the Summary's numbers.
 *  @param sinceMs optional lower bound (inclusive) on event.ts — older events drop. */
export function aggregateTracking(events: TrackEvent[], sinceMs?: number): TrackingSummary {
  const scoped = sinceMs == null ? events : events.filter((e) => e.ts >= sinceMs);
  if (scoped.length === 0) return EMPTY_TRACKING;

  let commits = 0;
  let prs = 0;
  let linesChanged = 0;
  for (const e of scoped) {
    commits += e.commits;
    prs += e.prs;
    linesChanged += e.linesAdded + e.linesRemoved;
  }

  // Recent wins: newest event first, keep the first occurrence of each title.
  const recentWins: RecentWin[] = [];
  const seen = new Set<string>();
  for (const e of [...scoped].sort((a, b) => b.ts - a.ts)) {
    for (const title of e.wins) {
      if (seen.has(title)) continue;
      seen.add(title);
      recentWins.push({ title, repo: e.repo, ts: e.ts });
      if (recentWins.length >= MAX_WINS) break;
    }
    if (recentWins.length >= MAX_WINS) break;
  }

  const sessions = scoped.length;
  return {
    sessions,
    commits,
    prs,
    linesChanged,
    hoursSaved: estimateHoursSaved({ linesChanged, commits, sessions }),
    recentWins,
  };
}
