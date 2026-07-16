// Server-only, admin-SDK mirrors of the read/mint helpers in lib/firebase/companyData.ts
// (a `'use client'` module using the CLIENT Firestore SDK). Server routes must never
// import the client versions: called from a Node route with no Firebase user session,
// the client SDK runs unauthenticated and Firestore rules deny the read/write outright
// (permission-denied in prod). These versions use adminDb() instead — the same pattern
// /api/track uses to read `ingestToken` — and are meant to be called with a companyId
// the route has already derived from a VERIFIED ID token (never trust it from the
// request body; see the cross-tenant IDOR note in app/api/build/cloud-start/route.ts).
import 'server-only';
import { adminDb } from './admin';
import { paths } from './schema';
import { dayKey } from '../ai/rateLimit';
import { creditsFromUsage, type UsageDocData } from '../billing';

/**
 * Credits consumed in the current billing month — admin-SDK mirror of
 * companyData.ts's `loadPeriodCredits`. Sums the per-route call counts recorded on
 * this month's daily usage docs (companies/{id}/usage/{yyyy-mm-dd}).
 */
export async function loadPeriodCreditsAdmin(
  companyId: string,
  now: Date = new Date(),
): Promise<number> {
  const monthPrefix = dayKey(now).slice(0, 7); // 'yyyy-mm'
  const snap = await adminDb().collection(`companies/${companyId}/usage`).get();
  const docs = snap.docs
    .filter((d) => d.id.startsWith(monthPrefix))
    .map((d) => d.data() as UsageDocData);
  return creditsFromUsage(docs);
}

/**
 * Return the company's ingest token, minting + persisting one on first use — admin-SDK
 * mirror of companyData.ts's `ensureIngestToken`. Same token shape (a hyphen-stripped
 * UUID) so the local installer's hook config keeps working unchanged.
 */
export async function ensureIngestTokenAdmin(companyId: string): Promise<string> {
  const ref = adminDb().doc(paths.company(companyId));
  const snap = await ref.get();
  const existing = snap.data()?.ingestToken;
  if (typeof existing === 'string' && existing) return existing;
  const token = crypto.randomUUID().replace(/-/g, '');
  await ref.set({ ingestToken: token, updatedAt: Date.now() }, { merge: true });
  return token;
}

/** Persist which GitHub App installation this company connected (cloud builds). */
export async function setCompanyGithub(
  companyId: string,
  gh: { installationId: string; login: string },
): Promise<void> {
  const ref = adminDb().doc(paths.company(companyId));
  await ref.set({ github: { ...gh, connectedAt: Date.now() } }, { merge: true });
}

/** Read back the company's connected GitHub App installation, if any. */
export async function getCompanyGithub(
  companyId: string,
): Promise<{ installationId: string; login: string } | null> {
  const ref = adminDb().doc(paths.company(companyId));
  const snap = await ref.get();
  const github = snap.data()?.github;
  if (!github?.installationId || !github?.login) return null;
  return { installationId: github.installationId, login: github.login };
}
