import { describe, it, expect } from 'vitest';
import { buildOpeningPrompt, terminalCommand, demoTerminalCommand, DEMO_DIR } from './armSession';
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

describe('demoTerminalCommand', () => {
  it('creates the demo dir, seeds index.html only if missing, then runs claude and serves it', () => {
    const cmd = demoTerminalCommand('build a landing page');
    expect(cmd).toContain('mkdir -p ~/codepet-demo');
    expect(cmd).toContain('cd ~/codepet-demo');
    expect(cmd).toContain('[ -f index.html ]');
    expect(cmd).toContain('base64 -d > index.html');
    expect(cmd).toContain('claude "build a landing page"');
    expect(cmd).toContain('python3 -m http.server 4321');
    expect(cmd).toContain('open http://localhost:4321');
    expect(cmd).toContain(
      'claude "build a landing page" ; python3 -m http.server 4321 >/dev/null 2>&1 & sleep 1 && open http://localhost:4321',
    );
  });
  it('exposes the demo dir constant', () => {
    expect(DEMO_DIR).toBe('~/codepet-demo');
  });
});
