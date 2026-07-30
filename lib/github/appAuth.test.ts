import { describe, it, expect } from 'vitest';
import { appJwtClaims } from './appAuth';

describe('appJwtClaims', () => {
  it('backdates iat 60s and sets exp within GitHub 10-min max', () => {
    const now = 1_000_000;
    const c = appJwtClaims('123', now);
    expect(c.iss).toBe('123');
    expect(c.iat).toBe(now - 60);
    expect(c.exp).toBe(now + 480); // 8 minutes
    // iat→exp window stays strictly under GitHub's 600s cap (with margin for clock drift).
    expect(c.exp - c.iat).toBe(540);
    expect(c.exp - c.iat).toBeLessThan(600);
  });
});
