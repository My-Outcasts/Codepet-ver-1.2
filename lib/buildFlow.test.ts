import { describe, it, expect } from 'vitest';
import {
  appendBrief,
  stepForLive,
  INTAKE_OPENING,
  INTAKE_FOLLOWUP,
  decideIntakeStep,
  READY_FALLBACK,
  MAX_INTAKE_QUESTIONS,
  isTransientBuildTrigger,
  stripBuildTriggers,
} from './buildFlow';

describe('appendBrief', () => {
  it('starts the brief with the first answer', () => {
    expect(appendBrief('', 'a todo app')).toBe('a todo app');
  });
  it('joins later answers with a newline', () => {
    expect(appendBrief('a todo app', 'for students')).toBe('a todo app\nfor students');
  });
  it('trims each answer and ignores blank ones', () => {
    expect(appendBrief('a todo app', '   ')).toBe('a todo app');
    expect(appendBrief('', '  hi  ')).toBe('hi');
  });
});

describe('stepForLive', () => {
  it('is "during" while the session is live or unknown', () => {
    expect(stepForLive(null)).toBe('during');
    expect(stepForLive({ ended: false })).toBe('during');
  });
  it('is "end" once the session has ended', () => {
    expect(stepForLive({ ended: true })).toBe('end');
  });
});

describe('intake copy', () => {
  it('provides a non-empty opening and follow-up line', () => {
    expect(INTAKE_OPENING.length).toBeGreaterThan(0);
    expect(INTAKE_FOLLOWUP.length).toBeGreaterThan(0);
  });
});

describe('decideIntakeStep', () => {
  it('falls back to the static follow-up when the AI call failed (null)', () => {
    expect(decideIntakeStep(null, 1)).toEqual({ mode: 'fallback', text: INTAKE_FOLLOWUP });
  });

  it('passes a ready reflect-back through with its text', () => {
    expect(decideIntakeStep({ kind: 'ready', text: "Here's what I'll build: X" }, 1)).toEqual({
      mode: 'ready',
      text: "Here's what I'll build: X",
    });
  });

  it('asks the next question below the cap', () => {
    expect(decideIntakeStep({ kind: 'question', text: 'who is it for?' }, 1)).toEqual({
      mode: 'question',
      text: 'who is it for?',
    });
  });

  it('forces ready when a question arrives at the cap', () => {
    expect(decideIntakeStep({ kind: 'question', text: 'one more?' }, MAX_INTAKE_QUESTIONS)).toEqual(
      { mode: 'ready', text: READY_FALLBACK },
    );
  });
});

describe('build trigger buttons', () => {
  it('treats begin-intake and to-plan as one-shot triggers', () => {
    // begin-intake used to linger, so a second tap re-appended INTAKE_OPENING → duplicate opener.
    expect(isTransientBuildTrigger('begin-intake')).toBe(true);
    expect(isTransientBuildTrigger('to-plan')).toBe(true);
  });

  it('leaves start-building and non-build kinds alone', () => {
    expect(isTransientBuildTrigger('start-building')).toBe(false);
    expect(isTransientBuildTrigger('anything-else')).toBe(false);
  });

  it('strips begin-intake and to-plan buttons but keeps the message text', () => {
    const msgs = [
      { id: 'a', text: 'plain answer' },
      { id: 'b', text: 'let’s build it', buildAction: { kind: 'begin-intake', label: '→' } },
      { id: 'c', text: 'ready?', buildAction: { kind: 'to-plan', label: '→' } },
      { id: 'd', text: 'go', buildAction: { kind: 'start-building', label: 'Start' } },
    ];
    const out = stripBuildTriggers(msgs);
    expect(out.map((m) => m.id)).toEqual(['a', 'b', 'c', 'd']); // nothing dropped
    expect(out[0]).not.toHaveProperty('buildAction');
    expect(out[1]).not.toHaveProperty('buildAction'); // begin-intake consumed
    expect(out[1].text).toBe('let’s build it'); // text preserved
    expect(out[2]).not.toHaveProperty('buildAction'); // to-plan consumed
    expect(out[3]).toHaveProperty('buildAction'); // start-building survives
  });

  it('does not mutate the input array', () => {
    const msgs = [{ id: 'b', buildAction: { kind: 'begin-intake', label: '→' } }];
    stripBuildTriggers(msgs);
    expect(msgs[0]).toHaveProperty('buildAction');
  });
});
