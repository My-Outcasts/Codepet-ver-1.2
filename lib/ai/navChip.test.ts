import { describe, it, expect } from 'vitest';
import { resolveNavChip, NAV_DESTINATIONS } from './navChip';

const DEPTS = [
  { k: 'mkt', name: 'Marketing' },
  { k: 'fin', name: 'Finance' },
];

describe('resolveNavChip', () => {
  it('resolves a top-level destination to its labelled chip', () => {
    expect(resolveNavChip('roadmap', undefined, DEPTS)).toEqual({
      label: 'Take me to the Roadmap',
      dest: 'roadmap',
    });
  });

  it('returns undefined for an unknown destination (hallucination guard)', () => {
    expect(resolveNavChip('settings', undefined, DEPTS)).toBeUndefined();
    expect(resolveNavChip('', undefined, DEPTS)).toBeUndefined();
  });

  it('resolves a department by name (case-insensitive) to its key', () => {
    expect(resolveNavChip('department', 'marketing', DEPTS)).toEqual({
      label: 'Open Marketing',
      dest: 'department',
      target: 'mkt',
    });
  });

  it('resolves a department by key', () => {
    expect(resolveNavChip('department', 'fin', DEPTS)).toEqual({
      label: 'Open Finance',
      dest: 'department',
      target: 'fin',
    });
  });

  it('returns undefined for department with no / unknown target', () => {
    expect(resolveNavChip('department', undefined, DEPTS)).toBeUndefined();
    expect(resolveNavChip('department', 'Legal', DEPTS)).toBeUndefined();
  });

  it('lists exactly the supported destinations', () => {
    expect([...NAV_DESTINATIONS]).toEqual([
      'roadmap',
      'tasks',
      'library',
      'company',
      'environment',
      'department',
    ]);
  });
});
