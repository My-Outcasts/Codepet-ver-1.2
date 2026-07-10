// Pure helpers for the first-run activation arc: turn the freshly scaffolded company
// into a reveal summary (shown in the wizard's final step) and build byte's landing
// greeting with a one-tap inline action. No React, no I/O — unit-tested in isolation.
import type { Dept } from '../data';
import type { NextStep } from '../ai/nextStep';
import type { CompanyBrief } from '../firebase/schema';
import { cleanCompanyName } from '../companyName';

export interface RevealSummary {
  /** True when the real scaffold produced a company (vs. the seed fallback). */
  ok: boolean;
  /** Active (non-dormant) departments. */
  deptCount: number;
  /** Open tasks across the active departments. */
  taskCount: number;
  /** Up to 3 active department names, for the reveal. */
  sampleDepts: string[];
  /** Up to 3 first-open task titles, for the reveal. */
  sampleTasks: string[];
}

export function buildRevealSummary(depts: Dept[], ok: boolean): RevealSummary {
  const active = depts.filter((d) => !d.later);
  const openTasks = active.flatMap((d) => d.tasks.filter((t) => !t.done));
  const sampleTasks = active
    .map((d) => d.tasks.find((t) => !t.done)?.t)
    .filter((t): t is string => Boolean(t))
    .slice(0, 3);
  return {
    ok,
    deptCount: active.length,
    taskCount: openTasks.length,
    sampleDepts: active.slice(0, 3).map((d) => d.name),
    sampleTasks,
  };
}

export interface FirstRunGreeting {
  text: string;
  action?: { label: string; deptK: string; taskTitle: string; inline: true };
}

export function buildFirstRunGreeting(
  brief: CompanyBrief,
  nextStep: NextStep | null,
): FirstRunGreeting {
  const who = brief.founderName?.trim();
  const proj = cleanCompanyName(brief.projectName) ?? 'your product';
  const lead = who
    ? `${who}, your company for ${proj} is ready.`
    : `Your company for ${proj} is ready.`;
  if (!nextStep) {
    return {
      text: `${lead} Take a look around — open any department to see what I've lined up, and I'll produce the work with you whenever you're ready.`,
    };
  }
  return {
    text: `${lead} The best first move is "${nextStep.taskTitle}". Want me to do it with you, right here? I'll draft it and you approve — nothing ships without your say-so.`,
    action: {
      label: `Do it with me: ${nextStep.taskTitle}`,
      deptK: nextStep.deptK,
      taskTitle: nextStep.taskTitle,
      inline: true,
    },
  };
}
