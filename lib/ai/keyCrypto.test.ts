import { describe, it, expect, beforeAll } from 'vitest';
import { encryptSecret, decryptSecret } from './keyCrypto';

beforeAll(() => {
  // A deterministic 32-byte key (base64) for the test run — encKey() reads it at call time.
  process.env.BYOK_ENC_KEY = Buffer.alloc(32, 7).toString('base64');
});

describe('keyCrypto', () => {
  it('round-trips a secret and never stores it in the clear', () => {
    const secret = 'sk-ant-abc123DEF456';
    const enc = encryptSecret(secret);
    expect(enc).not.toContain(secret);
    expect(decryptSecret(enc)).toBe(secret);
  });

  it('uses a fresh IV per call (same input → different ciphertext)', () => {
    expect(encryptSecret('x')).not.toBe(encryptSecret('x'));
  });

  it('rejects a tampered ciphertext (GCM auth tag)', () => {
    const enc = encryptSecret('secret');
    const [iv, tag, ct] = enc.split('.');
    const bad = Buffer.from(ct, 'base64');
    bad[0] ^= 0xff;
    expect(() => decryptSecret(`${iv}.${tag}.${bad.toString('base64')}`)).toThrow();
  });

  it('throws on a malformed blob', () => {
    expect(() => decryptSecret('nope')).toThrow();
  });
});
