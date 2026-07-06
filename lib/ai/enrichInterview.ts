// byte's first-chat enrichment, made testable. Onboarding captures thin, self-reported
// fields; the three signals that most shape a plan — the founder's immediate GOAL, real
// TRACTION/assets, and the PROBLEM they solve — are never asked for. This module drives a
// short, skippable interview: it detects which of those gaps are empty, supplies the
// question byte asks for each, and distills the founder's free-text reply into the brief
// field — grounded ONLY in what they said, never invented (same discipline as
// mergeEnrichment + BYTE_SYSTEM). Pure + dependency-free so it unit-tests in plain node;
// the model call + persistence live in /api/enrich-answer.
import type { CompanyBrief } from '../firebase/schema';

/** The three plan-shaping gaps byte fills, in priority order. */
export type Gap = 'goal' | 'traction' | 'problem';

/** Priority order: goal first (drives task priority), then traction (grounds the numbers),
 *  then problem (sharpens positioning). detectGaps preserves this order. */
export const GAP_ORDER: readonly Gap[] = ['goal', 'traction', 'problem'] as const;

/** The most gaps byte will ask about in one interview — keep it short. */
export const MAX_QUESTIONS = 3;

/** A field counts as filled only when it holds real (non-whitespace) text. */
function filled(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Which plan-shaping fields are still empty, in priority order. Returns [] when the brief
 * already has all three (byte asks nothing). Never more than MAX_QUESTIONS.
 */
export function detectGaps(brief: CompanyBrief | null | undefined): Gap[] {
  if (!brief) return [...GAP_ORDER].slice(0, MAX_QUESTIONS);
  return GAP_ORDER.filter((g) => !filled(brief[g])).slice(0, MAX_QUESTIONS);
}

/** The question byte asks for each gap, plus the one-line reason it's asking (so it reads
 *  like a companion, not a form). `ask` is a fallback; the greeting can template it with
 *  the founder's product summary for warmth. */
export const QUESTION_FOR: Record<Gap, { ask: string; why: string }> = {
  goal: {
    ask: "What's your main goal for the next few weeks?",
    why: 'so byte plans the moves that actually get you there first',
  },
  traction: {
    ask: 'Where are you right now — waitlist, users, revenue, anything live yet?',
    why: "so the numbers in your plan are yours, not made up",
  },
  problem: {
    ask: 'What problem does it solve, and who feels it most?',
    why: 'so your positioning and copy speak to the real user',
  },
};

/** byte's structured read of one free-text answer. `value` is the cleaned field text;
 *  empty string means the reply carried no real signal for this gap (treat as a skip). */
export interface InterviewAnswer {
  value: string;
}

export const INTERVIEW_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    value: {
      type: 'string',
      description:
        "A concise, plain-language capture of what the founder actually said for this field, in their terms. Keep their real numbers and specifics verbatim; do not embellish, infer beyond, or invent. Empty string if the reply contains no usable answer (e.g. they deflected or skipped).",
    },
  },
  required: ['value'],
};

/** Build the distill prompt: byte reads ONE free-text reply into ONE brief field. */
export function buildDistillPrompt(gap: Gap, rawAnswer: string): string {
  const q = QUESTION_FOR[gap];
  return (
    `byte asked the founder: "${q.ask}"\n` +
    `They replied:\n"""\n${rawAnswer.trim().slice(0, 2000)}\n"""\n\n` +
    `Capture their answer as a concise ${gap} statement, in their own terms and with their real ` +
    `numbers/specifics kept exact. Do NOT invent, embellish, or add anything they did not say. ` +
    `If the reply has no real answer, return an empty string.`
  );
}

const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/**
 * Merge byte's distilled answer into the brief for one gap. Never overrides an
 * already-filled field, and an empty distill (a skip / no-signal reply) is a no-op —
 * the field stays empty so the anti-fabrication guardrail keeps byte honest downstream.
 */
export function mergeAnswer(brief: CompanyBrief, gap: Gap, answer: InterviewAnswer): CompanyBrief {
  if (filled(brief[gap])) return brief;
  const value = clip(answer?.value, 600);
  if (!value) return brief;
  return { ...brief, [gap]: value };
}
