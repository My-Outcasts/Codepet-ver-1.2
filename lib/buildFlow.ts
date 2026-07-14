// Pure, framework-free helpers for the "Let's build" flow that now lives in the
// byte chat. The chat drives START (intake → plan); the store arms the session and
// the main view renders DURING/END. Kept dependency-free so the transitions are
// unit-tested without React or network. See
// docs/superpowers/specs/2026-07-06-build-coach-in-chat-design.md.
import type { LiveState } from './liveBuild';

/** The two main-view steps that survive the move to chat (START is now in chat). */
export type BuildStep = 'during' | 'end';

/** Byte's opening intake question — natural, warm, one question. */
export const INTAKE_OPENING = `Ooh, let's build something! Tell me what you have in mind — who's it for, and what does "done" look like? 💭`;

/** Byte's single scripted follow-up, shown after the founder's first answer. */
export const INTAKE_FOLLOWUP = `Love it! Anything else it must do? Add as much as you like — when you're ready, hit "Turn this into a plan". 😎`;

/** Suggested build prompt for the demo "Let's build" flow. */
export const DEMO_BUILD_BRIEF =
  'A simple landing page for a neighborhood coffee shop — a warm hero with the name and tagline, three menu highlights, opening hours, and a "Visit us" call-to-action.';

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
