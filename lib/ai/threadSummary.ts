// Pure logic for the rolling per-thread summary. Byte's chat only sends the most recent
// MAX_CHAT_TURNS turns to the model (chatMessages.ts); older turns fall off a cliff and are
// lost unless they became a durable decision. This module decides which dropped turns to
// condense into a persisted "conversation so far" summary that rides along in the prompt,
// so long threads keep their earlier context. Kept dependency-free so it unit-tests without
// React, the SDK, or the network — the model call + persistence live at the callers.
import { MAX_CHAT_TURNS, type ChatTurn } from './chatMessages';

/**
 * Fold the rolling summary only once at least this many un-summarized turns have dropped
 * off the window, so we batch summarizer calls instead of running one on every message
 * past the window (bounds cost + latency).
 */
export const SUMMARY_BATCH = 8;

/** A chat turn carrying its timestamp — the marker is a ts, not a count (see below). */
export interface TurnRef extends ChatTurn {
  /** Message timestamp; the rolling-summary high-water mark is the newest folded ts. */
  ts: number;
}

export interface SummarizePlan {
  /** The dropped, not-yet-summarized turns to fold into the summary now (empty ⇒ skip). */
  turns: ChatTurn[];
  /** New high-water mark: the newest turn ts now covered by the summary. */
  throughTs: number;
}

/**
 * Decide which turns to roll into the thread summary. The most recent `window` turns stay
 * verbatim; everything before that is "dropped". We fold the dropped turns *newer than*
 * `summarizedThroughTs`, but only once at least `batch` of them have accumulated.
 *
 * The marker is a TIMESTAMP, not a count, on purpose: on reload only the last
 * CHAT_LOAD_LIMIT messages hydrate, so an absolute count would no longer line up with the
 * truncated in-memory history and summarization would silently stall. A ts marker is
 * coordinate-independent — it works against whatever slice of the thread is in memory.
 */
export function planThreadSummary(
  history: TurnRef[],
  summarizedThroughTs: number,
  window = MAX_CHAT_TURNS,
  batch = SUMMARY_BATCH,
): SummarizePlan {
  const marker = Number.isFinite(summarizedThroughTs) ? summarizedThroughTs : 0;
  const dropCount = Math.max(0, history.length - window); // no longer sent verbatim
  // Dropped turns not yet folded = those past the window AND newer than the marker.
  const pending = history.slice(0, dropCount).filter((t) => t.ts > marker);
  if (pending.length < batch) return { turns: [], throughTs: marker };
  const turns = pending.map((t) => ({ role: t.role, text: t.text }));
  const throughTs = pending.reduce((mx, t) => Math.max(mx, t.ts), marker);
  return { turns, throughTs };
}

/** The prompt block injected into byte's system prompt (empty when there's no summary). */
export function formatThreadSummaryBlock(summary: string | undefined | null): string {
  const s = (summary ?? '').trim();
  return s ? `\n\nEarlier in this conversation (older turns, condensed):\n${s}` : '';
}

/** System prompt for the rolling-summary model call (kept here so the route stays thin). */
export const SUMMARY_SYSTEM =
  "You maintain a running summary of a founder's ongoing chat with byte, their AI building companion. You are given the summary so far plus the next batch of older messages about to scroll out of view. Rewrite the summary so it still captures the durable context a companion should remember — what the founder wants, their constraints, preferences, decisions, and any concrete facts or numbers — and drop small talk. Keep it to one tight paragraph under ~150 words, plain third-person. Never invent anything not present in the messages.";

/** Render the fold prompt: prior summary + the newly-dropped turns. Pure + testable. */
export function buildSummaryPrompt(priorSummary: string, turns: ChatTurn[]): string {
  const prior = (priorSummary ?? '').trim();
  const convo = turns
    .map((t) => `${t.role === 'byte' ? 'byte' : 'Founder'}: ${(t.text ?? '').trim()}`)
    .join('\n');
  const priorBlock = prior ? `Summary so far:\n${prior}\n\n` : 'There is no summary yet.\n\n';
  return `${priorBlock}Next older messages (about to scroll out of view):\n${convo}\n\nWrite the updated running summary.`;
}
