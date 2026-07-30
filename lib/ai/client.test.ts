import { describe, it, expect } from 'vitest';
import {
  classifyFailureKind,
  errorInfo,
  errorCodeOf,
  GenerationError,
  cachedSystem,
} from './client';

describe('errorInfo', () => {
  it('reads status + message off any error shape (duck-typed, not instanceof)', () => {
    // A plain object mirroring an SDK error not recognized by instanceof — the case the
    // eval harness surfaced.
    const like = { status: 400, message: 'Your credit balance is too low' };
    expect(errorInfo(like)).toEqual({ status: 400, message: 'Your credit balance is too low' });
  });
  it('falls back to 502 + stringified error for a non-HTTP throw', () => {
    expect(errorInfo(new Error('boom'))).toEqual({ status: 502, message: 'boom' });
    expect(errorInfo('nope').status).toBe(502);
  });
  it('composes with classifyFailureKind to catch billing regardless of error class', () => {
    const { status, message } = errorInfo({ status: 400, message: 'credit balance too low' });
    expect(classifyFailureKind(status, message)).toBe('billing');
  });
});

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

describe('errorCodeOf', () => {
  it('maps GenerationError kinds', () => {
    expect(errorCodeOf(new GenerationError({ kind: 'billing' }), 'x')).toBe('ai_unavailable');
    expect(errorCodeOf(new GenerationError({ kind: 'refused' }), 'x')).toBe('refused');
    expect(errorCodeOf(new GenerationError({ kind: 'not_configured' }), 'x')).toBe(
      'not_configured',
    );
    expect(errorCodeOf(new GenerationError({ kind: 'upstream', status: 500 }), 'fb')).toBe('fb');
  });
  it('classifies a raw credit/billing error to ai_unavailable', () => {
    expect(errorCodeOf({ status: 400, message: 'credit balance is too low' }, 'fb')).toBe(
      'ai_unavailable',
    );
  });
  it('unknown error → fallback', () => {
    expect(errorCodeOf(new Error('boom'), 'fb')).toBe('fb');
  });
});

describe('cachedSystem', () => {
  const CC = { type: 'ephemeral' };

  it('string input → exactly one cached block (backward compat)', () => {
    expect(cachedSystem('hello')).toEqual([{ type: 'text', text: 'hello', cache_control: CC }]);
  });

  it('{stable, volatile} → stable cached first, volatile uncached second, in order', () => {
    const blocks = cachedSystem({ stable: 'S', volatile: 'V' });
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: 'text', text: 'S', cache_control: CC });
    expect(blocks[1]).toEqual({ type: 'text', text: 'V' });
    expect(blocks[1].cache_control).toBeUndefined();
  });

  it('{stable} with absent or empty volatile → one cached block, no empty trailing block', () => {
    const expected = [{ type: 'text', text: 'S', cache_control: CC }];
    expect(cachedSystem({ stable: 'S' })).toEqual(expected);
    expect(cachedSystem({ stable: 'S', volatile: '' })).toEqual(expected);
  });

  it('passes stable/volatile text through unmodified (byte-identical prefix preserved)', () => {
    const stable = '  leading and trailing whitespace kept  ';
    const blocks = cachedSystem({ stable, volatile: 'x' });
    expect(blocks[0].text).toBe(stable);
    expect(blocks[1].text).toBe('x');
  });
});
