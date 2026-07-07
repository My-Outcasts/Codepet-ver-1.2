import { describe, it, expect } from 'vitest';
import { isObjectId, rewindPlan, SAVEPOINT_MESSAGE } from './gitCheckpoint';

describe('isObjectId', () => {
  it('accepts hex object ids', () => {
    expect(isObjectId('a1b2c3d')).toBe(true);
    expect(isObjectId('0123456789abcdef0123456789abcdef01234567')).toBe(true);
  });
  it('rejects refs, injections, and non-strings', () => {
    expect(isObjectId('HEAD')).toBe(false);
    expect(isObjectId('main')).toBe(false);
    expect(isObjectId('a1b2c3d; rm -rf /')).toBe(false);
    expect(isObjectId('../../etc')).toBe(false);
    expect(isObjectId('')).toBe(false);
    expect(isObjectId(null)).toBe(false);
    expect(isObjectId(123)).toBe(false);
  });
});

describe('rewindPlan', () => {
  it('resets to the snapshot then cleans build-created files', () => {
    expect(rewindPlan('abc1234')).toEqual([
      ['reset', '--hard', 'abc1234'],
      ['clean', '-fd'],
    ]);
  });
  it('never uses clean -x (keeps ignored files like node_modules)', () => {
    const flat = rewindPlan('abc1234').flat();
    expect(flat).not.toContain('-x');
    expect(flat).not.toContain('-fdx');
  });
});

describe('SAVEPOINT_MESSAGE', () => {
  it('is a stable marker', () => {
    expect(SAVEPOINT_MESSAGE).toBe('codepet-savepoint');
  });
});
