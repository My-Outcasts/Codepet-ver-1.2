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
  it('includes the brief and every plan step', () => {
    const p = buildOpeningPrompt(plan, 'email login for returning users');
    expect(p).toContain('email login for returning users');
    for (const s of plan.steps) expect(p).toContain(s);
  });

  it('tells claude to work non-interactively (no questions / AskUserQuestion)', () => {
    const p = buildOpeningPrompt(plan, 'anything');
    expect(p).toMatch(/non-interactive/i);
    expect(p).toContain('AskUserQuestion');
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
