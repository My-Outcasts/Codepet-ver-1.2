// The step-by-step walkthrough of the Overview map. A single card that tells the founder
// "this whole thing is your company" isn't enough — most people don't know how to read a
// force-directed graph or what to do on it. So byte WALKS them across the real map: it
// flies the camera to each element in turn, dims the rest, and explains that one thing,
// teaching the colour language in context as each colour first appears.
//
// Kept pure so the step list + transitions are unit-testable under node-env Vitest; the
// React layer (OverviewTour / OverviewView) is a thin consumer that resolves each step's
// `target` to a live map node and drives the camera.

import { GUIDE_HEX } from './overviewIntro';

// The map elements a step can point at. 'map' = the whole company (no single node);
// 'stage' = the journey strip up top (not a graph node); the rest resolve to real nodes.
export type TourTarget = 'project' | 'dept' | 'task' | 'stage' | 'beacon';

/** One colour taught in context at the stop where it first matters. */
export interface TourLegend {
  hex: string;
  label: string;
}

export interface TourStep {
  target: TourTarget;
  /** Short heading in byte's voice. */
  title: string;
  /** One or two plain sentences. May contain `{dept}` / `{stage}` tokens the UI fills. */
  body: string;
  /** Colours to teach at this stop (rendered as small chips under the body). */
  legend?: TourLegend[];
  /** Primary-button label. The last step's CTA hands off to the lit next move. */
  cta: string;
}

// Legend hexes mirror the map + the intro card's key (cyan next-move, purple byte-does,
// gold you-approve, blue needs-you, green done). Cyan reuses GUIDE_HEX so the guide-star
// colour is defined once.
const CYAN = GUIDE_HEX;
const PURPLE = '#8B5CF6';
const GOLD = '#FDB022';
const BLUE = '#3B82F6';
const GREEN = '#34D399';

// Five stops: center → a department branch → its task dots (teach who-does-what) →
// the journey strip → the single lit next move (teach the guide-star, hand off to Start).
export const TOUR_STEPS: readonly TourStep[] = [
  {
    target: 'project',
    title: 'Start at the center',
    body: 'This dot is your whole company. Everything on the map branches out from here.',
    cta: 'Next',
  },
  {
    target: 'dept',
    title: 'Each branch is a department',
    body: 'I set one up for every part of the company. This branch is {dept} — click any branch to open it.',
    cta: 'Next',
  },
  {
    target: 'task',
    title: 'The small dots are tasks',
    body: 'Every dot on a branch is a real piece of work. Its colour tells you who’s on it:',
    legend: [
      { hex: PURPLE, label: 'I’ll do it' },
      { hex: GOLD, label: 'I draft, you approve' },
      { hex: BLUE, label: 'needs you' },
      { hex: GREEN, label: 'done' },
    ],
    cta: 'Next',
  },
  {
    target: 'stage',
    title: 'Your journey stage',
    body: 'The strip up top is where you are: Find → Build → Ship → Launch → Run. You’re in {stage}.',
    cta: 'Next',
  },
  {
    target: 'beacon',
    title: 'Your next move — start here',
    body: 'I always keep exactly one move lit: the single next thing that matters. When you’re ready, start it.',
    legend: [{ hex: CYAN, label: 'your next move (always just one)' }],
    cta: 'Start here',
  },
] as const;

/** Fill `{dept}` / `{stage}` tokens from live data; a missing value degrades to a plain
 *  phrasing rather than leaving a literal token on screen. */
export function fillTourBody(body: string, vars: { dept?: string; stage?: string }): string {
  return body
    .replace('{dept}', vars.dept?.trim() || 'one of your departments')
    .replace('{stage}', vars.stage?.trim() || 'your current stage');
}

/** Clamp-advance to the next step (never past the last). */
export function nextTourStep(i: number, total: number = TOUR_STEPS.length): number {
  return Math.min(i + 1, total - 1);
}

/** True once we're on the final step (its CTA finishes the tour). */
export function isLastStep(i: number, total: number = TOUR_STEPS.length): boolean {
  return i >= total - 1;
}
