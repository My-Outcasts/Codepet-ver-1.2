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

export interface SummarizePlan {
  /** The dropped, not-yet-summarized turns to fold into the summary now (empty ⇒ skip). */
  turns: ChatTurn[];
  /** New high-water mark: how many leading turns are covered once these are folded in. */
  through: number;
}

/**
 * Decide which turns to roll into the thread summary. A thread of `total` turns keeps the
 * most recent `window` verbatim; everything before that is "dropped". We summarize the
 * dropped turns beyond `summarizedThrough`, but only once at least `batch` of them have
 * accumulated — so short threads and single-turn drops never trigger a summarizer call.
 */
export function planThreadSummary(
  history: ChatTurn[],
  summarizedThrough: number,
  window = MAX_CHAT_TURNS,
  batch = SUMMARY_BATCH,
): SummarizePlan {
  const covered = Math.max(0, Math.floor(summarizedThrough) || 0);
  const droppedCount = Math.max(0, history.length - window); // no longer sent verbatim
  const pending = droppedCount - covered; // dropped but not yet in the summary
  if (pending < batch) return { turns: [], through: covered };
  return { turns: history.slice(covered, droppedCount), through: droppedCount };
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
