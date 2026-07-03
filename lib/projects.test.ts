import { describe, it, expect } from 'vitest';
import { sanitizeProjects, MAX_PROJECTS, projectNames } from './projects';

describe('sanitizeProjects', () => {
  it('keeps valid entries, trimming name and path', () => {
    expect(sanitizeProjects([{ name: '  codepet  ', path: ' /Users/me/codepet ' }])).toEqual([
      { name: 'codepet', path: '/Users/me/codepet' },
    ]);
  });

  it('drops entries missing a name or path', () => {
    expect(
      sanitizeProjects([
        { name: '', path: '/x' },
        { name: 'ok', path: '' },
        { name: 'good', path: '/good' },
      ]),
    ).toEqual([{ name: 'good', path: '/good' }]);
  });

  it('dedupes by path (first wins)', () => {
    const out = sanitizeProjects([
      { name: 'a', path: '/same' },
      { name: 'b', path: '/same' },
    ]);
    expect(out).toEqual([{ name: 'a', path: '/same' }]);
  });

  it('returns [] for non-array or junk input', () => {
    expect(sanitizeProjects(null)).toEqual([]);
    expect(sanitizeProjects('nope')).toEqual([]);
    expect(sanitizeProjects([1, 'x', null])).toEqual([]);
  });

  it('caps the number of projects at MAX_PROJECTS', () => {
    const many = Array.from({ length: MAX_PROJECTS + 20 }, (_, i) => ({
      name: `p${i}`,
      path: `/p${i}`,
    }));
    expect(sanitizeProjects(many)).toHaveLength(MAX_PROJECTS);
  });
});

describe('projectNames', () => {
  it('maps to names and dedupes duplicate names', () => {
    expect(
      projectNames([
        { name: 'app', path: '/a/app' },
        { name: 'app', path: '/b/app' },
        { name: 'web', path: '/web' },
      ]),
    ).toEqual(['app', 'web']);
  });
});
