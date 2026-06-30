// Server-only Firebase Admin. Used to verify Firebase ID tokens on API routes so
// the Claude endpoint can't be called by unauthenticated clients. NEVER import
// this from client code — it pulls the Admin SDK and (optionally) a service-account
// key.
//
// Credentials: for ID-token *verification* the project id alone is sufficient
// (the SDK fetches Google's public certs and checks the audience). A service
// account is only needed for privileged ops (custom tokens, checkRevoked), so it's
// optional — set FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY to enable it.
import 'server-only';
import { initializeApp, getApps, getApp, cert, type App } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';

function getAdminApp(): App {
  if (getApps().length) return getApp();

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (projectId && clientEmail && privateKey) {
    return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  }
  // Verify-only: project id is enough to validate ID tokens.
  return initializeApp({ projectId });
}

/** Verify a Firebase ID token. Throws if invalid/expired. */
export function verifyIdToken(idToken: string): Promise<DecodedIdToken> {
  return getAuth(getAdminApp()).verifyIdToken(idToken);
}
