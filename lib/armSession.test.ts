import { describe, it, expect } from 'vitest';
import { buildOpeningPrompt, terminalCommand } from './armSession';
import type { BytePlan } from './ai/plan';

const plan: BytePlan = {
  title: "Byte's got it!",
  budgetK: 300,
  budgetActions: 12,
  steps: ['Scaffold the form', 'Wire validation', 'Double-check it works'],
};

describe('buildOpeningPrompt', () => {
  it('includes audience, done criteria, and every plan step', () => {
    const p = buildOpeningPrompt(plan, 'returning users', 'email login works');
    expect(p).toContain('returning users');
    expect(p).toContain('email login works');
    for (const s of plan.steps) expect(p).toContain(s);
  });
});

describe('terminalCommand', () => {
  it('cds into the project and launches claude with the prompt', () => {
    const cmd = terminalCommand('/Users/me/proj', 'hello');
    expect(cmd).toBe('cd "/Users/me/proj" && claude "hello"');
  });

  it('escapes double quotes and backslashes in the prompt and dir', () => {
    const cmd = terminalCommand('/tmp/a"b', 'say "hi"\\done');
    expect(cmd).toBe('cd "/tmp/a\\"b" && claude "say \\"hi\\"\\\\done"');
  });
});
