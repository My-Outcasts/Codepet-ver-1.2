import { describe, it, expect } from 'vitest';
import { sanitizeIntakeInput, intakePrompt, INTAKE_SCHEMA } from './intake';

describe('sanitizeIntakeInput', () => {
  it('requires at least one non-blank turn', () => {
    expect(sanitizeIntakeInput(null)).toBeNull();
    expect(sanitizeIntakeInput({})).toBeNull();
    expect(sanitizeIntakeInput({ turns: ['   '] })).toBeNull();
  });

  it('trims, caps, and keeps only the most recent turns', () => {
    const turns = Array.from({ length: 20 }, (_, i) => ` turn ${i} `);
    const input = sanitizeIntakeInput({ turns, context: 'x'.repeat(2000), project: 'app' });
    expect(input!.turns.length).toBe(12);
    expect(input!.turns.at(-1)).toBe('turn 19');
    expect(input!.context.length).toBe(1200);
    expect(input!.project).toBe('app');
  });

  it('drops non-string junk from turns', () => {
    const input = sanitizeIntakeInput({ turns: ['a login form', 42, null, ''] });
    expect(input!.turns).toEqual(['a login form']);
  });
});

describe('intakePrompt', () => {
  it('grounds the question in the scan and lists the turns in order', () => {
    const p = intakePrompt({
      context: 'Stack: Next.js\nDependencies: stripe',
      turns: ['a paywall', 'for the pro plan'],
      project: 'my-app',
    });
    expect(p).toContain('Project: my-app');
    expect(p).toContain('Dependencies: stripe');
    expect(p).toContain('1. a paywall');
    expect(p).toContain('2. for the pro plan');
    expect(p).toMatch(/ONE short question/);
  });

  it('omits the scan block when there is no context (hosted without a brief)', () => {
    const p = intakePrompt({ context: '', turns: ['a form'] });
    expect(p).not.toContain('quick scan of the project');
  });
});

describe('INTAKE_SCHEMA', () => {
  it('requires say + enough with no extras (strict structured-output subset)', () => {
    expect(INTAKE_SCHEMA.required).toEqual(['say', 'enough']);
    expect(INTAKE_SCHEMA.additionalProperties).toBe(false);
  });
});
