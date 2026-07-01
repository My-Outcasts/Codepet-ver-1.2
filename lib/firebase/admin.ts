// Server-only Firebase ID-token verification. Used by the API routes so the Claude
// endpoints can't be called by unauthenticated clients. NEVER import from client code.
//
// Why not firebase-admin? Its `verifyIdToken` pulls in jwks-rsa, which `require()`s
// `jose` — and modern jose is ESM-only, so the require throws ERR_REQUIRE_ESM inside
// Vercel's traced serverless bundle (it works locally, fails in prod). Since we only
// need to VERIFY tokens (no custom tokens / no checkRevoked / no service account), we
// verify directly against Firebase's public JWKS with jose (ESM-native, edge-safe).
// This is exactly the "project id is enough" path firebase-admin took, minus the
// broken CommonJS dependency chain.
import 'server-only';
import { jwtVerify, createRemoteJWKSet, type JWTPayload } from 'jose';

// Firebase's public keys for Secure Token Service ID tokens, in JWK Set form.
// createRemoteJWKSet caches them and refreshes on key rotation / unknown `kid`.
const FIREBASE_JWKS = createRemoteJWKSet(
  new URL(
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
  ),
);

function getProjectId(): string {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error('Firebase project id is not configured (FIREBASE_PROJECT_ID).');
  }
  return projectId;
}

export interface VerifiedToken extends JWTPayload {
  /** The authenticated user's Firebase uid (the token `sub`). */
  uid: string;
}

/**
 * Verify a Firebase ID token. Checks the RS256 signature against Firebase's JWKS and
 * enforces the issuer/audience/expiry Firebase requires. Throws if invalid/expired.
 */
export async function verifyIdToken(idToken: string): Promise<VerifiedToken> {
  const projectId = getProjectId();
  const { payload } = await jwtVerify(idToken, FIREBASE_JWKS, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
    algorithms: ['RS256'],
  });
  if (!payload.sub) throw new Error('ID token is missing a subject (uid).');
  return { ...payload, uid: payload.sub };
}
