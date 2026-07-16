// GitHub redirects here after the founder installs (or updates) the Codepet GitHub App.
// The `state` param is the HMAC-signed companyId minted by /api/github/connect (see
// lib/github/state.ts) — it's the ONLY trustworthy source of which company this
// installation binds to. `installation_id` comes from GitHub's query string and is
// otherwise unauthenticated, so we never let it (or any other query param) name the
// company: a forged/expired `state` must 401 with nothing written to Firestore.
import { verifyState } from '@/lib/github/state';
import { setCompanyGithub, setCompanyGithubUserToken } from '@/lib/firebase/companyDataAdmin';
import { exchangeUserCode } from '@/lib/github/appAuth';

export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const installationId = searchParams.get('installation_id') ?? '';
  const state = searchParams.get('state');

  const st = verifyState(state);
  if (!st) {
    return Response.json({ error: 'invalid_state' }, { status: 401 });
  }

  if (!installationId.trim()) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  await setCompanyGithub(st.companyId, { installationId, login: '' });

  // Best-effort: a failed/absent code exchange must never block the install binding
  // or the redirect — repo creation just falls back to "not connected yet".
  const code = searchParams.get('code');
  if (code) {
    const userToken = await exchangeUserCode(code);
    if (userToken) await setCompanyGithubUserToken(st.companyId, userToken);
  }

  return Response.redirect(new URL('/', req.url), 302);
}
