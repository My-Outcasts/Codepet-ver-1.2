// Pure, framework-free helpers for the "Let's build" flow that now lives in the
// byte chat. The chat drives START (intake → plan); the store arms the session and
// the main view renders DURING/END. Kept dependency-free so the transitions are
// unit-tested without React or network. See
// docs/superpowers/specs/2026-07-06-build-coach-in-chat-design.md.
import type { LiveState } from './liveBuild';
import type { BrainstormReply } from './ai/brainstorm';

/** The two main-view steps that survive the move to chat (START is now in chat). */
export type BuildStep = 'during' | 'end';

/** Byte's opening intake question — natural, warm, one question. */
export const INTAKE_OPENING = `Ooh, let's build something! Tell me what you have in mind — who's it for, and what does "done" look like? 💭`;

/** Byte's single scripted follow-up, shown after the founder's first answer. */
export const INTAKE_FOLLOWUP = `Love it! Anything else it must do? Add as much as you like — when you're ready, hit "Turn this into a plan". 😎`;

/** Append one intake answer to the running brief (newline-joined, blank-safe). */
export function appendBrief(brief: string, text: string): string {
  const t = text.trim();
  if (!t) return brief;
  return brief ? `${brief}\n${t}` : t;
}

/** Which main-view step matches the current live state: END once ended, else DURING. */
export function stepForLive(live: Pick<LiveState, 'ended'> | null): BuildStep {
  return live?.ended ? 'end' : 'during';
}

/** Most questions Byte asks before it must reflect back and offer to build. */
export const MAX_INTAKE_QUESTIONS = 3;

/** Byte's wrap-up line when the founder hits the question cap. */
export const READY_FALLBACK = `Alright — I've got enough to get started. Want me to turn this into a plan? 😎`;

/** What Byte does after a founder's intake answer. `question` re-prompts with no
 *  button; `ready` and `fallback` both attach the "to-plan" button (different label). */
export type IntakeStep =
  | { mode: 'question'; text: string }
  | { mode: 'ready'; text: string }
  | { mode: 'fallback'; text: string };

/** Decide Byte's next intake step. `reply === null` means the AI call failed →
 *  fall back to the static flow. `userTurns` is how many answers the founder has
 *  now given (>= 1); at the cap a lingering question is forced to wrap up. */
export function decideIntakeStep(reply: BrainstormReply | null, userTurns: number): IntakeStep {
  if (reply === null) return { mode: 'fallback', text: INTAKE_FOLLOWUP };
  if (reply.kind === 'ready') return { mode: 'ready', text: reply.text };
  if (userTurns >= MAX_INTAKE_QUESTIONS) return { mode: 'ready', text: READY_FALLBACK };
  return { mode: 'question', text: reply.text };
}
