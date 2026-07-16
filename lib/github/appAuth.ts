import 'server-only';
import jwt from 'jsonwebtoken';

/** GitHub App JWT claims. iat backdated 60s (clock skew); exp +8min so the iat→exp window
 *  is 540s — safely under GitHub's hard 10-min (600s) cap even with clock drift. */
export function appJwtClaims(
  appId: string,
  nowSec: number,
): { iss: string; iat: number; exp: number } {
  return { iss: appId, iat: nowSec - 60, exp: nowSec + 480 };
}

/** Sign the App JWT (RS256) from env — the credential used to mint installation tokens. */
export function appJwt(nowSec: number): string {
  const key = (process.env.GITHUB_APP_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  return jwt.sign(appJwtClaims(process.env.GITHUB_APP_ID ?? '', nowSec), key, {
    algorithm: 'RS256',
  });
}

/**
 * Mint a short-lived installation access token scoped to `repositories` (repo NAMES
 * only, e.g. ['web'] — GitHub resolves them within the installation's account). Pass
 * `[]` to get a token scoped to every repo the installation covers.
 *
 * SECURITY: never log the returned token. On a non-2xx response we throw with just
 * the status — not the response body, which may itself contain sensitive detail.
 */
export async function installationToken(
  installationId: string,
  repositories: string[],
): Promise<string> {
  const resp = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${appJwt(Math.floor(Date.now() / 1000))}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ repositories }),
    },
  );
  if (!resp.ok) {
    throw new Error(`GitHub installation token request failed: ${resp.status}`);
  }
  const data = (await resp.json()) as { token: string };
  return data.token;
}
