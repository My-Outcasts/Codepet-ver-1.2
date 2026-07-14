import { describe, it, expect } from 'vitest';
import {
  appendBrief,
  stepForLive,
  INTAKE_OPENING,
  INTAKE_FOLLOWUP,
  decideIntakeStep,
  READY_FALLBACK,
  MAX_INTAKE_QUESTIONS,
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
    expect(
      decideIntakeStep({ kind: 'question', text: 'one more?' }, MAX_INTAKE_QUESTIONS),
    ).toEqual({ mode: 'ready', text: READY_FALLBACK });
  });
});
