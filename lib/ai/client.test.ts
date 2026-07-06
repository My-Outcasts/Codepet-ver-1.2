import { describe, it, expect } from 'vitest';
import { classifyFailureKind } from './client';

describe('classifyFailureKind', () => {
  it('classifies the real Anthropic credit-exhaustion error as billing', () => {
    // The exact message the API returned when the org ran out of credits.
    const msg =
      'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.';
    expect(classifyFailureKind(400, msg)).toBe('billing');
  });

  it('classifies a 402 quota/billing message as billing', () => {
    expect(classifyFailureKind(402, 'Insufficient quota for this request')).toBe('billing');
    expect(classifyFailureKind(400, 'billing issue on your account')).toBe('billing');
  });

  it('does NOT classify other 400s as billing', () => {
    expect(classifyFailureKind(400, 'messages: roles must alternate')).toBe('upstream');
    expect(classifyFailureKind(400, 'invalid request: max_tokens too large')).toBe('upstream');
  });

  it('classifies rate-limit / server errors as upstream (not billing)', () => {
    expect(classifyFailureKind(429, 'rate limited')).toBe('upstream');
    expect(classifyFailureKind(529, 'overloaded')).toBe('upstream');
    expect(classifyFailureKind(500, 'internal error')).toBe('upstream');
  });

  it('is case-insensitive on the message', () => {
    expect(classifyFailureKind(400, 'CREDIT BALANCE too low')).toBe('billing');
  });
});
