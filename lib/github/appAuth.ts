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
