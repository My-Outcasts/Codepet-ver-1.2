// Starts the GitHub App install flow: verifies the founder's Firebase ID token, mints a
// tamper-proof `state` param binding this install to their companyId (see
// lib/github/state.ts), and hands back the App's install URL for the client to navigate
// to. Deliberately returns the URL instead of a server-side redirect — the client attaches
// auth as a fetch header (there's no cookie session to ride a redirect on), then does
// `window.location.href = url` itself. GitHub redirects back to /api/github/callback,
// which verifies the same signed state before binding the installation to a company.
import { verifyIdToken } from '@/lib/firebase/admin';
import { signState } from '@/lib/github/state';

export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  const authz = req.headers.get('authorization') ?? '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  if (!idToken) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  let decoded;
  try {
    decoded = await verifyIdToken(idToken);
  } catch {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  // Scoped to the verified token's uid (companyId === uid, per firestore.rules'
  // ownsByConvention) — NEVER trust a companyId from the request, or a signed-in founder
  // could bind another company's account to their own GitHub installation.
  const companyId = decoded.uid;

  const state = signState({ companyId, nonce: crypto.randomUUID() });
  const appSlug = process.env.GITHUB_APP_SLUG ?? 'codepet-builder';
  const url = `https://github.com/apps/${appSlug}/installations/new?state=${encodeURIComponent(state)}`;

  return Response.json({ url });
}
