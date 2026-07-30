// BYOK key store — the user's own Anthropic key, ENCRYPTED, in an admin-only Firestore doc.
//
// Stored at `userSecrets/{uid}` which the security rules DENY to every client (see
// firestore.rules) — only this server code, via the Admin SDK (adminDb, service-account
// credentialed), can read/write it, bypassing rules. The value is additionally AES-GCM encrypted
// (keyCrypto) so the raw key is never at rest in plaintext. Server-only.
import 'server-only';
import { adminDb } from './admin';
import { encryptSecret, decryptSecret } from '../ai/keyCrypto';
import { getClient } from '../ai/client';

const SECRETS = 'userSecrets';

export type ByokKeyStatus = 'valid' | 'invalid' | 'unchecked';

/** Non-sensitive status for the client (NEVER the key or the cipher). */
export interface ByokStatus {
  present: boolean;
  last4?: string;
  status?: ByokKeyStatus;
  checkedAt?: number;
}

/**
 * The user's decrypted Anthropic key, or null if they haven't set one (or anything goes wrong).
 * FAIL-OPEN: any error returns null so generation quietly falls back to the platform key rather
 * than breaking a paid feature on an infra blip.
 */
export async function resolveUserKey(uid: string): Promise<string | null> {
  try {
    const snap = await adminDb().collection(SECRETS).doc(uid).get();
    const data = snap.data();
    if (!data?.byok || typeof data.cipher !== 'string') return null;
    return decryptSecret(data.cipher);
  } catch {
    return null;
  }
}

/** Encrypt + persist the user's key (last4 kept in clear for the masked UI display). */
export async function storeUserKey(
  uid: string,
  plainKey: string,
  status: ByokKeyStatus,
): Promise<void> {
  await adminDb()
    .collection(SECRETS)
    .doc(uid)
    .set(
      {
        byok: true,
        cipher: encryptSecret(plainKey),
        last4: plainKey.slice(-4),
        status,
        checkedAt: Date.now(),
      },
      { merge: true },
    );
}

/** Turn BYOK off and wipe the stored key. */
export async function clearUserKey(uid: string): Promise<void> {
  await adminDb()
    .collection(SECRETS)
    .doc(uid)
    .set(
      { byok: false, cipher: null, last4: null, status: null, checkedAt: Date.now() },
      { merge: true },
    );
}

/**
 * The Anthropic client a route should use for this user, plus whether it's on the user's OWN key.
 * When `byok` is true the caller waives the daily cap (they pay their own Anthropic bill). One
 * Firestore read; fail-open to the platform key. This is the single seam every AI route wires to.
 */
export async function aiClientFor(uid: string): Promise<{
  client: ReturnType<typeof getClient>;
  byok: boolean;
}> {
  const key = await resolveUserKey(uid);
  return { client: getClient(key ?? undefined), byok: !!key };
}

/** The safe-to-return status (no secret material). */
export async function getByokStatus(uid: string): Promise<ByokStatus> {
  try {
    const snap = await adminDb().collection(SECRETS).doc(uid).get();
    const d = snap.data();
    if (!d?.byok) return { present: false };
    return {
      present: true,
      last4: typeof d.last4 === 'string' ? d.last4 : undefined,
      status: d.status as ByokKeyStatus | undefined,
      checkedAt: typeof d.checkedAt === 'number' ? d.checkedAt : undefined,
    };
  } catch {
    return { present: false };
  }
}
