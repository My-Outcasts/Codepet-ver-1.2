import { describe, it, expect } from 'vitest';
import { sanitizePlanInput, buildPlanPrompt, PLAN_SCHEMA } from './plan';

describe('sanitizePlanInput', () => {
  it('returns trimmed fields for a valid body', () => {
    expect(sanitizePlanInput({ audience: '  founders  ', doneLooks: ' email login ' })).toEqual({
      audience: 'founders',
      doneLooks: 'email login',
    });
  });

  it('returns null when audience is missing or blank', () => {
    expect(sanitizePlanInput({ doneLooks: 'x' })).toBeNull();
    expect(sanitizePlanInput({ audience: '   ', doneLooks: 'x' })).toBeNull();
  });

  it('returns null when doneLooks is missing or blank', () => {
    expect(sanitizePlanInput({ audience: 'x' })).toBeNull();
    expect(sanitizePlanInput({ audience: 'x', doneLooks: '' })).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(sanitizePlanInput(null)).toBeNull();
    expect(sanitizePlanInput('nope')).toBeNull();
  });

  it('caps each field length', () => {
    const long = 'a'.repeat(500);
    const out = sanitizePlanInput({ audience: long, doneLooks: long });
    expect(out?.audience.length).toBe(400);
    expect(out?.doneLooks.length).toBe(400);
  });

  it('keeps a trimmed project when provided', () => {
    const out = sanitizePlanInput({ audience: 'x', doneLooks: 'y', project: '  Engineering  ' });
    expect(out?.project).toBe('Engineering');
  });

  it('omits project when blank or absent', () => {
    expect(sanitizePlanInput({ audience: 'x', doneLooks: 'y' })?.project).toBeUndefined();
    expect(
      sanitizePlanInput({ audience: 'x', doneLooks: 'y', project: '   ' })?.project,
    ).toBeUndefined();
  });
});

describe('buildPlanPrompt', () => {
  it('embeds both inputs and asks for a plan', () => {
    const p = buildPlanPrompt({
      audience: 'returning users',
      doneLooks: 'email login, remember me',
    });
    expect(p).toContain('returning users');
    expect(p).toContain('email login, remember me');
    expect(p.toLowerCase()).toContain('plan');
  });

  it('includes the project when present and omits it otherwise', () => {
    const withProject = buildPlanPrompt({ audience: 'a', doneLooks: 'b', project: 'Engineering' });
    expect(withProject).toContain('Engineering');
    const without = buildPlanPrompt({ audience: 'a', doneLooks: 'b' });
    expect(without).not.toContain('Engineering');
  });

  it('asks for an action budget', () => {
    const p = buildPlanPrompt({ audience: 'a', doneLooks: 'b' });
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
