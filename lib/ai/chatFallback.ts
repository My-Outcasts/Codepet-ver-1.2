// When a streamed chat turn produces nothing the user can see, byte still has to say
// something — an empty bubble reads as a bug, not a decline. This module owns that
// decision (pure, so it's unit-tested) and the honest line byte streams in its place.
//
// The two cases that need a fallback:
//   1. The model DECLINED the turn (`stop_reason === 'refusal'`) — a real, if rare,
//      safety refusal. byte should own it plainly, not vanish.
//   2. The model returned NO text AND byte didn't act (no task run / nav / setup). A
//      turn that ran a task with no prose is a real response and is exempt.

/** What byte streams when a turn is declined or comes back empty. Honest + actionable:
 *  names that byte held back and points at the two things that usually unblock it. */
export const REFUSAL_FALLBACK =
  'I held back on that one — I couldn’t draft a reply I was comfortable with. Try rephrasing, or give me a bit more detail about what you need.';

/**
 * Should byte stream the fallback line for this turn? True on a refusal stop reason, or
 * when nothing streamed and byte took no action. Pure — the route passes in the final
 * stop reason, how many chars streamed, and whether a tool action fired.
 */
export function needsFallbackReply(opts: {
  stopReason: string | null;
  streamedChars: number;
  acted: boolean;
}): boolean {
  if (opts.stopReason === 'refusal') return true;
  return opts.streamedChars === 0 && !opts.acted;
}
