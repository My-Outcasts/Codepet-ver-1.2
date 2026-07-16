// A tamper-proof `state` param for the GitHub App connect redirect: it carries the
// companyId across GitHub's install page and back to /api/github/callback. HMAC-signed
// with GITHUB_STATE_SECRET so a caller can't forge which company an installation binds to.
import { createHmac, timingSafeEqual } from 'node:crypto';

function secret(): string {
  const s = process.env.GITHUB_STATE_SECRET;
  // Fail closed: an unset secret must NOT coerce to '' (a globally-known empty key) —
  // that would let anyone forge a valid state. A misconfigured server errors instead.
  if (!s) throw new Error('GITHUB_STATE_SECRET is not set');
  return s;
}
function sign(body: string): string {
  return createHmac('sha256', secret()).update(body).digest('base64url');
}

export function signState(payload: { companyId: string; nonce: string }): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifyState(raw: unknown): { companyId: string; nonce: string } | null {
  if (typeof raw !== 'string') return null;
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const obj = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (obj && typeof obj.companyId === 'string' && typeof obj.nonce === 'string') {
      return { companyId: obj.companyId, nonce: obj.nonce };
    }
    return null;
  } catch {
    return null;
  }
}
