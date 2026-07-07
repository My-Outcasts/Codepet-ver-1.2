'use client';
// Part 1 — client side of the stage-aware scaffold. Asks /api/scaffold for a company
// tailored to the founder's stage + product, applies it onto the DEPTS singleton, and
// persists it so returning users hydrate the scaffold (no regeneration). Best-effort:
// any failure leaves the current departments in place — onboarding already succeeded,
// so this never blocks or surfaces an error.
import { authHeader } from './runTask';
import type { CompanyBrief } from '../firebase/schema';
import { applyScaffold, persistScaffold, type ScaffoldDept } from '../firebase/companyData';

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
    const data = (await res.json()) as { scaffold?: { departments?: ScaffoldDept[] } };
    const generated = data.scaffold?.departments ?? [];
    if (!generated.length) return { changed: 0, failure: 'empty' };

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
