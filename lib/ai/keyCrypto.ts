// BYOK secret encryption — AES-256-GCM with a server-held key (BYOK_ENC_KEY). Defense in depth
// on top of the admin-only Firestore doc: even if the stored ciphertext leaked, the user's
// Anthropic key stays encrypted. Server-only — the key material never reaches the client.
import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/** The 32-byte AES key, from a base64 `BYOK_ENC_KEY` env var. Throws if missing/malformed so a
 *  misconfigured server fails LOUD on store (never silently persists a plaintext-ish blob). */
function encKey(): Buffer {
  const raw = process.env.BYOK_ENC_KEY;
  if (!raw) throw new Error('BYOK_ENC_KEY is not configured.');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32)
    throw new Error('BYOK_ENC_KEY must decode to 32 bytes (base64 of a 256-bit key).');
  return buf;
}

/** Encrypt to `ivB64.tagB64.cipherB64`. A fresh random IV per call (never reuse with GCM). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

/** Reverse encryptSecret. Throws on a malformed blob or a failed auth tag (tamper/wrong key). */
export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, encB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !encB64) throw new Error('malformed ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', encKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}
