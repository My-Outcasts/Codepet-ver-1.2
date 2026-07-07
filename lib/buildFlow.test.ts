import { describe, it, expect } from 'vitest';
import { appendBrief, stepForLive, INTAKE_OPENING, INTAKE_FOLLOWUP } from './buildFlow';

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
