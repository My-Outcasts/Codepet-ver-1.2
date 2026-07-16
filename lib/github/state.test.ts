import { describe, it, expect, beforeEach } from 'vitest';
import { signState, verifyState } from './state';

beforeEach(() => {
  process.env.GITHUB_STATE_SECRET = 'test-secret';
});

describe('github state', () => {
  it('round-trips a signed state', () => {
    const s = signState({ companyId: 'co1', nonce: 'n1' });
    expect(verifyState(s)).toEqual({ companyId: 'co1', nonce: 'n1' });
  });
  it('rejects a tampered payload', () => {
    const s = signState({ companyId: 'co1', nonce: 'n1' });
    const [body, sig] = s.split('.');
    const forged = Buffer.from(JSON.stringify({ companyId: 'evil', nonce: 'n1' })).toString(
      'base64url',
    );
    expect(verifyState(`${forged}.${sig}`)).toBeNull();
    expect(verifyState(`${body}.deadbeef`)).toBeNull();
  });
  it('returns null for malformed input', () => {
    expect(verifyState(null)).toBeNull();
    expect(verifyState('nope')).toBeNull();
    expect(verifyState('a.b.c')).toBeNull();
  });
});
