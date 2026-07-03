import { describe, it, expect } from 'vitest';
import { sanitizePlanInput, buildPlanPrompt, PLAN_SCHEMA } from './plan';

describe('sanitizePlanInput', () => {
  it('returns the trimmed brief for a valid body', () => {
    expect(sanitizePlanInput({ brief: '  email login for founders  ' })).toEqual({
      brief: 'email login for founders',
    });
  });

  it('returns null when brief is missing or blank', () => {
    expect(sanitizePlanInput({})).toBeNull();
    expect(sanitizePlanInput({ brief: '   ' })).toBeNull();
    expect(sanitizePlanInput({ project: 'Engineering' })).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(sanitizePlanInput(null)).toBeNull();
    expect(sanitizePlanInput('nope')).toBeNull();
  });

  it('caps the brief length', () => {
    const long = 'a'.repeat(500);
    const out = sanitizePlanInput({ brief: long });
    expect(out?.brief.length).toBe(400);
  });

  it('keeps a trimmed project when provided', () => {
    const out = sanitizePlanInput({ brief: 'x', project: '  Engineering  ' });
    expect(out?.project).toBe('Engineering');
  });

  it('omits project when blank or absent', () => {
    expect(sanitizePlanInput({ brief: 'x' })?.project).toBeUndefined();
    expect(sanitizePlanInput({ brief: 'x', project: '   ' })?.project).toBeUndefined();
  });
});

describe('buildPlanPrompt', () => {
  it('embeds the brief and asks for a plan', () => {
    const p = buildPlanPrompt({ brief: 'email login, remember me for returning users' });
    expect(p).toContain('email login, remember me for returning users');
    expect(p.toLowerCase()).toContain('plan');
  });

  it('includes the project when present and omits it otherwise', () => {
    const withProject = buildPlanPrompt({ brief: 'a', project: 'Engineering' });
    expect(withProject).toContain('Engineering');
    const without = buildPlanPrompt({ brief: 'a' });
    expect(without).not.toContain('Engineering');
  });

  it('asks for an action budget', () => {
    const p = buildPlanPrompt({ brief: 'a' });
    expect(p).toContain('budgetActions');
  });
});

describe('PLAN_SCHEMA', () => {
  it('requires budgetActions as an integer', () => {
    expect(PLAN_SCHEMA.required as string[]).toContain('budgetActions');
    const props = PLAN_SCHEMA.properties as Record<string, { type?: string }>;
    expect(props.budgetActions?.type).toBe('integer');
  });
});
