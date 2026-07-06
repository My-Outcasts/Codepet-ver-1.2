import { describe, it, expect } from 'vitest';
import { describePermission } from './permissionSummary';

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
