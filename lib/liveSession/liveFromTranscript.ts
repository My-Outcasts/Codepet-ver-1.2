// Pure: project the in-UI session transcript onto the LiveState shape the DURING
// meter + END recap read. Local in-UI builds have no hook→Firestore feed (the arm
// file is only written for terminal/remote sessions), so the store folds the
// transcript it already streams into buildLive with this instead. No I/O.
import type { LiveState } from '../liveBuild';
import { RECENT_TOOLS_CAP } from '../liveBuild';
import type { Millis } from '../firebase/schema';
import type { TranscriptState } from './transcript';
import { friendlyTool } from './permissionSummary';

/** Byte's "waiting on you" lines for the two blocked states. */
export const ASK_PERMISSION = 'Byte is waiting for your OK on the next step — check the card 👀';
export const ASK_REPLY = 'Claude is waiting on your reply — type in the chat below ✍️';

const SAY_MAX = 160;

export function liveFromTranscript(t: TranscriptState, startedAt: Millis, now: Millis): LiveState {
  const lastAssistant = [...t.messages].reverse().find((m) => m.role === 'assistant')?.text;
  const lastSay = lastAssistant?.trim() ? lastAssistant.trim().slice(0, SAY_MAX) : undefined;
  const pendingAsk =
    t.status === 'awaiting-question' && t.pendingQuestion
      ? t.pendingQuestion.question.slice(0, SAY_MAX)
      : t.status === 'awaiting-permission'
        ? ASK_PERMISSION
        : t.status === 'awaiting-input'
          ? ASK_REPLY
          : undefined;
  const out: LiveState = {
    sessionId: t.sessionId ?? '',
    actionCount: t.actionCount,
    turns: t.messages.filter((m) => m.role === 'assistant').length,
    recentTools: t.tools.slice(-RECENT_TOOLS_CAP).map((tool) => friendlyTool(tool.name).verb),
    startedAt,
    lastTs: now,
    ended: t.status === 'ended' || t.status === 'error',
  };
  if (lastSay !== undefined) out.lastSay = lastSay;
  if (pendingAsk !== undefined) out.pendingAsk = pendingAsk;
  return out;
}
