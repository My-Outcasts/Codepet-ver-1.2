import { describe, it, expect } from 'vitest';
import { budgetState, DANGER_PCT } from './buildCoach';

describe('budgetState', () => {
  it('is calm and locked well below the danger threshold', () => {
    const s = budgetState(25);
    expect(s.mood).toBe('ok');
    expect(s.warn).toBe(false);
    expect(s.unlock).toBe(false);
    expect(s.label).toContain('track');
  });

  it('stays calm just under the danger threshold', () => {
    const s = budgetState(DANGER_PCT - 1); // 79
    expect(s.mood).toBe('ok');
    expect(s.warn).toBe(false);
    expect(s.unlock).toBe(false);
  });

  it('turns worried, warns, and unlocks exactly at the danger threshold', () => {
    const s = budgetState(DANGER_PCT); // 80
    expect(s.mood).toBe('worried');
    expect(s.warn).toBe(true);
    expect(s.unlock).toBe(true);
    expect(s.label).toContain('worried');
  });

  it('remains worried at the ceiling', () => {
    const s = budgetState(100);
    expect(s.mood).toBe('worried');
    expect(s.warn).toBe(true);
    expect(s.unlock).toBe(true);
  });
});
