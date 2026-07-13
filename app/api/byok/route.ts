// BYOK management — set/validate, clear, and read status for the caller's own Anthropic key.
// Auth-gated by a Firebase ID token (uid). The raw key is validated with a 1-token test call,
// then encrypted + stored server-side (userSecrets/{uid}, admin-only). It is NEVER returned to
// the client and NEVER logged; only a masked last4 + status come back.
import 'server-only';
import { verifyIdToken } from '@/lib/firebase/admin';
import { getClient, MODEL } from '@/lib/ai/client';
import {
  storeUserKey,
  clearUserKey,
  getByokStatus,
  type ByokKeyStatus,
} from '@/lib/firebase/serverUserKey';

export const runtime = 'nodejs';

async function requireUid(req: Request): Promise<string | null> {
  const authz = req.headers.get('authorization') ?? '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  if (!idToken) return null;
  try {
    return (await verifyIdToken(idToken)).uid;
  } catch {
    return null;
  }
}

/** True when the failure is an auth/permission rejection (a genuinely bad key), vs a transient
 *  or billing error (key is probably fine, we just couldn't fully verify). */
function isAuthFailure(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  return status === 401 || status === 403;
}

export async function GET(req: Request): Promise<Response> {
  const uid = await requireUid(req);
  if (!uid) return Response.json({ error: 'unauthorized' }, { status: 401 });
  return Response.json(await getByokStatus(uid));
}

export async function POST(req: Request): Promise<Response> {
  const uid = await requireUid(req);
  if (!uid) return Response.json({ error: 'unauthorized' }, { status: 401 });

  let key = '';
  try {
    const body = (await req.json()) as { key?: unknown };
    key = typeof body.key === 'string' ? body.key.trim() : '';
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  // Cheap format gate before spending a call: real keys look like `sk-ant-…`.
  if (!key.startsWith('sk-ant-') || key.length < 20) {
    return Response.json(
      { error: 'invalid_key', message: 'That doesn’t look like an Anthropic API key.' },
      { status: 400 },
    );
  }

  // Validate with a 1-token test generation on the user's OWN key.
  let status: ByokKeyStatus;
  try {
    await getClient(key).messages.create({
      model: MODEL,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    });
    status = 'valid';
  } catch (err) {
    if (isAuthFailure(err)) {
      return Response.json(
        { error: 'invalid_key', message: 'Anthropic rejected that key.' },
        { status: 400 },
      );
    }
    // Non-auth failure (rate limit / low credit / transient) — the key authenticated well enough
    // to reach the API, so accept it but flag as unchecked; real generations surface any issue.
    status = 'unchecked';
  }

  try {
    await storeUserKey(uid, key, status);
  } catch {
    // Most likely BYOK_ENC_KEY not configured on the server — fail loud, don't store plaintext.
    return Response.json(
      { error: 'not_configured', message: 'Key storage isn’t configured on the server.' },
      { status: 503 },
    );
  }
  return Response.json({ present: true, status, last4: key.slice(-4) });
}

export async function DELETE(req: Request): Promise<Response> {
  const uid = await requireUid(req);
  if (!uid) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    await clearUserKey(uid);
  } catch {
    return Response.json({ error: 'server_error' }, { status: 500 });
  }
  return Response.json({ present: false });
}
