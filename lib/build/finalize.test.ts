import { describe, it, expect } from 'vitest';
import { sanitizeFinalizeBody } from './finalize';

const b64 = (s: string) => Buffer.from(s).toString('base64');

describe('sanitizeFinalizeBody', () => {
  it('accepts safe relative files and clamps tokens', () => {
    const out = sanitizeFinalizeBody({
      tokens: 1234.9,
      files: [
        { path: 'index.html', base64: b64('<h1>hi</h1>') },
        { path: 'assets/app.css', base64: b64('body{}') },
      ],
    });
    expect(out).toEqual({
      tokens: 1234,
      files: [
        { path: 'index.html', base64: b64('<h1>hi</h1>') },
        { path: 'assets/app.css', base64: b64('body{}') },
      ],
    });
  });

  it('rejects path traversal, absolute, backslash, and null-byte paths', () => {
    for (const path of ['../secret', '/etc/passwd', 'a/../../b', 'a\\b', 'x\0']) {
      expect(sanitizeFinalizeBody({ tokens: 0, files: [{ path, base64: b64('x') }] })).toBeNull();
    }
  });

  it('rejects too many files or oversize payload', () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ path: `f${i}.txt`, base64: b64('x') }));
    expect(sanitizeFinalizeBody({ tokens: 0, files: many })).toBeNull();
    const big = [{ path: 'big.bin', base64: Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64') }];
    expect(sanitizeFinalizeBody({ tokens: 0, files: big })).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(sanitizeFinalizeBody(null)).toBeNull();
    expect(sanitizeFinalizeBody({ tokens: 0, files: 'nope' })).toBeNull();
    expect(sanitizeFinalizeBody({ tokens: 0, files: [{ path: 'a', base64: 123 }] })).toBeNull();
    expect(sanitizeFinalizeBody({ tokens: 0, files: [] })).toBeNull(); // must build something
  });

  it('clamps a huge token count and floors negatives to 0', () => {
    expect(sanitizeFinalizeBody({ tokens: 9e12, files: [{ path: 'i.html', base64: b64('x') }] })?.tokens).toBe(2_000_000_000);
    expect(sanitizeFinalizeBody({ tokens: -5, files: [{ path: 'i.html', base64: b64('x') }] })?.tokens).toBe(0);
  });
});
