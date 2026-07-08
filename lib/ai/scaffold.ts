'use client';
// Part 1 — client side of the stage-aware scaffold. Asks /api/scaffold for a company
// tailored to the founder's stage + product, applies it onto the DEPTS singleton, and
// persists it so returning users hydrate the scaffold (no regeneration). Best-effort:
// any failure leaves the current departments in place — onboarding already succeeded,
// so this never blocks or surfaces an error.
import { authHeader } from './runTask';
import type { CompanyBrief } from '../firebase/schema';
import { applyScaffold, persistScaffold, type ScaffoldDept } from '../firebase/companyData';
import { DEPTS_SEED } from '../data';

// All-or-nothing coverage: only a scaffold that returned an entry for EVERY department is a
// real tailoring. A partial one would leave some departments on the Codepet seed while the
// map claims to be tailored — so we reject it (keep the example, offer Retry) rather than
// mislabel it.
export function coversAllDepartments(generated: { k?: unknown }[]): boolean {
  const keys = new Set(generated.map((g) => g.k));
  return DEPTS_SEED.every((d) => keys.has(d.k));
}

/**
 * Generate + apply the stage-appropriate company. Returns the number of departments
 * changed (0 on any failure, so the caller keeps the current set) plus the failure
 * cause (null on success) so the caller can be honest about *why* it didn't happen.
 */
export async function scaffoldCompany(
  companyId: string,
  brief?: CompanyBrief,
): Promise<{ changed: number; failure: string | null }> {
  try {
    const res = await fetch('/api/scaffold', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ brief }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { changed: 0, failure: data.error || 'generation_failed' };
    }
    const data = (await res.json()) as {
      scaffold?: { departments?: ScaffoldDept[] };
      noBrief?: boolean;
    };
    // No real brief to tailor from → neutral (not a failure): the example seed stands and
    // the banner invites "Generate my plan".
    if (data.noBrief) return { changed: 0, failure: null };
    const generated = data.scaffold?.departments ?? [];
    if (!generated.length) return { changed: 0, failure: 'empty' };
    // All-or-nothing: a partial scaffold would leave Codepet seed in the missing departments.
    if (!coversAllDepartments(generated)) return { changed: 0, failure: 'incomplete' };

    const changed = applyScaffold(generated);
    if (!changed.length) return { changed: 0, failure: 'empty' };

    await persistScaffold(companyId, changed).catch((err) => {
      // In-memory apply already happened, so the founder sees the scaffold this
      // session even if the write fails; it just won't persist.
      console.error('[scaffold] persist failed', err);
    });
    return { changed: changed.length, failure: null };
  } catch (err) {
    console.error('[scaffold] failed', err);
    return { changed: 0, failure: 'network' };
  }
}
