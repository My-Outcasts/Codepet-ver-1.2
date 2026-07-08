import { describe, it, expect } from 'vitest';
import { buildOpeningPrompt, terminalCommand, terminalLaunchCandidates } from './armSession';
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

  it('twoWay allows questions instead of forbidding them (the in-UI live session)', () => {
    const p = buildOpeningPrompt(plan, 'anything', { twoWay: true });
    expect(p).not.toMatch(/non-interactive/i);
    expect(p).not.toContain('do NOT ask');
    expect(p).toMatch(/watching this session live/i);
    expect(p).toContain('codepet_ask');
    for (const s of plan.steps) expect(p).toContain(s);
  });
});

describe('terminalLaunchCandidates', () => {
  it('windows opens one cmd window carrying the command', () => {
    const c = terminalLaunchCandidates('win32', 'echo hi');
    expect(c).toHaveLength(1);
    expect(c[0].cmd).toBe('cmd');
    expect(c[0].args).toContain('echo hi');
  });

  it('linux tries the common emulators in order, each keeping the shell open', () => {
    const c = terminalLaunchCandidates('linux', 'echo hi');
    expect(c.map((x) => x.cmd)).toEqual([
      'x-terminal-emulator',
      'gnome-terminal',
      'konsole',
      'xterm',
    ]);
    for (const x of c) expect(x.args.join(' ')).toContain('echo hi; exec bash');
  });

  it('darwin (handled via osascript) and unknown platforms yield none', () => {
    expect(terminalLaunchCandidates('darwin', 'x')).toEqual([]);
    expect(terminalLaunchCandidates('sunos', 'x')).toEqual([]);
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
