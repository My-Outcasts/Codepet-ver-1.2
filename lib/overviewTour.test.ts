import { describe, it, expect } from 'vitest';
import {
  TOUR_STEPS,
  fillTourBody,
  nextTourStep,
  isLastStep,
  type TourTarget,
} from './overviewTour';

describe('TOUR_STEPS', () => {
  it('walks center → department → tasks → stage → the lit next move, in order', () => {
    const targets = TOUR_STEPS.map((s) => s.target);
    expect(targets).toEqual<TourTarget[]>(['project', 'dept', 'task', 'stage', 'beacon']);
  });

  it('every step has a title, body, and CTA', () => {
    for (const s of TOUR_STEPS) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.body.length).toBeGreaterThan(0);
      expect(s.cta.length).toBeGreaterThan(0);
    }
  });

  it('teaches colours only where they first matter (task + beacon stops)', () => {
    const withLegend = TOUR_STEPS.filter((s) => s.legend?.length).map((s) => s.target);
    expect(withLegend).toEqual<TourTarget[]>(['task', 'beacon']);
    // The beacon stop teaches exactly the one guide-star colour.
    expect(TOUR_STEPS.at(-1)!.legend).toHaveLength(1);
  });

  it('the last stop hands off with a "start" CTA', () => {
    expect(TOUR_STEPS.at(-1)!.cta.toLowerCase()).toContain('start');
  });
});

describe('fillTourBody', () => {
  it('interpolates dept + stage tokens', () => {
    expect(fillTourBody('This branch is {dept}.', { dept: 'Marketing' })).toBe(
      'This branch is Marketing.',
    );
    expect(fillTourBody('You’re in {stage}.', { stage: 'Build' })).toBe('You’re in Build.');
  });

  it('degrades to a readable phrase when a value is missing — never leaves a raw token', () => {
    const out = fillTourBody('This branch is {dept}, in {stage}.', {});
    expect(out).not.toContain('{dept}');
    expect(out).not.toContain('{stage}');
    expect(out).toContain('one of your departments');
  });
});

describe('nextTourStep / isLastStep', () => {
  it('advances but never past the last step', () => {
    expect(nextTourStep(0)).toBe(1);
    expect(nextTourStep(TOUR_STEPS.length - 1)).toBe(TOUR_STEPS.length - 1);
  });

  it('flags the final step', () => {
    expect(isLastStep(TOUR_STEPS.length - 1)).toBe(true);
    expect(isLastStep(0)).toBe(false);
  });
});
