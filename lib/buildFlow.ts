// Pure, framework-free helpers for the "Let's build" flow that now lives in the
// byte chat. The chat drives START (intake → plan); the store arms the session and
// the main view renders DURING/END. Kept dependency-free so the transitions are
// unit-tested without React or network. See
// docs/superpowers/specs/2026-07-06-build-coach-in-chat-design.md.
import type { LiveState } from './liveBuild';

/** The two main-view steps that survive the move to chat (START is now in chat). */
export type BuildStep = 'during' | 'end';

/** Byte's opening intake line — the project comes first, so the brainstorm can
 *  be grounded in a real codebase scan. */
export const INTAKE_OPENING = `Ooh, let's build something! First — which project are we building in? Pick one below. 👇`;

/** Scripted follow-up — the fallback when the AI brainstorm call fails. */
export const INTAKE_FOLLOWUP = `Love it! Anything else it must do? Add as much as you like — when you're ready, hit "Turn this into a plan". 😎`;

/** Byte's line once enough questions have been asked (or the AI cap is hit). */
export const INTAKE_ENOUGH = `Plenty to go on — hit "Turn this into a plan" whenever you're ready! 🚀`;

/** Max AI brainstorm questions before Byte stops asking and nudges to plan. */
export const MAX_INTAKE_QUESTIONS = 3;

/** Minimal shape of a project brief the openers read (matches ProjectBriefData). */
export interface BriefLike {
  frameworks?: string[];
  deps?: string[];
  dirs?: string[];
  readme?: string;
}

/** One founder-readable line describing a scanned project, or '' when empty. */
export function briefLine(brief: BriefLike | null | undefined): string {
  if (!brief) return '';
  const stack = (brief.frameworks ?? []).slice(0, 3).join(' + ');
  const extras = (brief.deps ?? [])
    .filter((d) => !(brief.frameworks ?? []).some((f) => f.toLowerCase().startsWith(d)))
    .slice(0, 3)
    .join(', ');
  if (stack && extras) return `a ${stack} app (I spot ${extras})`;
  if (stack) return `a ${stack} app`;
  if (extras) return `an app using ${extras}`;
  return '';
}

/** Prompt-ready scan text for the intake/plan calls, '' when there's nothing.
 *  (Pure TS twin of lib/installer/projectBrief.mjs#briefText — that module pulls
 *  in node:fs, so the client can't import it.) */
export function briefToText(brief: BriefLike | null | undefined): string {
  if (!brief) return '';
  const parts: string[] = [];
  if (brief.frameworks?.length) parts.push(`Stack: ${brief.frameworks.join(', ')}`);
  if (brief.deps?.length) parts.push(`Dependencies: ${brief.deps.join(', ')}`);
  if (brief.dirs?.length) parts.push(`Folders: ${brief.dirs.join(', ')}`);
  if (brief.readme) parts.push(`README: ${brief.readme}`);
  return parts.join('\n').slice(0, 1200);
}

/** Byte's opener once a project is chosen — scan-informed when a brief exists. */
export function scanOpening(project: string, brief: BriefLike | null | undefined): string {
  const line = briefLine(brief);
  return line
    ? `Ok — ${project}: ${line}. What do you want to build in here? Who's it for, and what does "done" look like? 💭`
    : `Ok, ${project} it is! Tell me what you have in mind — who's it for, and what does "done" look like? 💭`;
}

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
