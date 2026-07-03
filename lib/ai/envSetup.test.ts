import { describe, it, expect } from 'vitest';
import {
  collectSetupItems,
  parseSetupItems,
  matchSetupItem,
  resolveEnvIndex,
  type SetupItem,
} from './envSetup';
import type { EnvItem } from '@/lib/data';

const env: Record<string, EnvItem[]> = {
  skills: [
    { n: 'PRD writer', ab: 'Pr', d: 'spec', s: 1, why: 'specs' },
    { n: 'Code review', ab: 'Cr', d: 'reviews diffs', s: 0, why: 'catch bugs' },
  ],
  connectors: [{ n: 'Notion', ab: 'No', d: 'sync docs', s: 0 }],
  agents: [{ n: 'Explorer', ab: 'Ex', d: 'searches', s: 1 }],
};

describe('collectSetupItems', () => {
  it('returns only off items, with why falling back to d', () => {
    expect(collectSetupItems(env)).toEqual<SetupItem[]>([
      { category: 'skills', name: 'Code review', why: 'catch bugs' },
      { category: 'connectors', name: 'Notion', why: 'sync docs' },
    ]);
  });
});

describe('parseSetupItems', () => {
  it('keeps valid rows and drops junk', () => {
    const raw = [
      { category: 'skills', name: 'Code review', why: 'x' },
      { category: 'bogus', name: 'Nope', why: 'x' },
      { name: 'no category' },
      42,
    ];
    expect(parseSetupItems(raw)).toEqual([{ category: 'skills', name: 'Code review', why: 'x' }]);
  });
  it('returns [] for non-arrays', () => {
    expect(parseSetupItems(undefined)).toEqual([]);
  });
});

describe('matchSetupItem', () => {
  const items = collectSetupItems(env);
  it('matches case-insensitively on category + name', () => {
    expect(matchSetupItem(items, 'connectors', 'notion')?.name).toBe('Notion');
  });
  it('rejects an item not in the allowed (off) list', () => {
    expect(matchSetupItem(items, 'skills', 'PRD writer')).toBeNull(); // already on
    expect(matchSetupItem(items, 'skills', 'invented')).toBeNull();
  });
});

describe('resolveEnvIndex', () => {
  it('finds the index case-insensitively', () => {
    expect(resolveEnvIndex(env, 'skills', 'code review')).toBe(1);
  });
  it('returns -1 for unknown category or name', () => {
    expect(resolveEnvIndex(env, 'skills', 'nope')).toBe(-1);
    expect(resolveEnvIndex(env, 'nope', 'Notion')).toBe(-1);
  });
});
