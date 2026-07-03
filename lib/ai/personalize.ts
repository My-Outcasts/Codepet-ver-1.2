'use client';
// Phase 5.3 — client side of the one-time seed personalization. Runs right after
// onboarding: asks the server route to rewrite the department/task text for this
// company, merges the result onto the in-memory DEPTS singleton, and persists it so
// returning users hydrate the personalized version (no regeneration). Best-effort: any
// failure leaves the generic seed in place — onboarding has already succeeded, this is
// an enhancement layer, so it never blocks or surfaces an error.
import { authHeader } from './runTask';
import type { CompanyBrief } from '../firebase/schema';
import {
  applyPersonalization,
  persistPersonalization,
  type PersonalizedDept,
} from '../firebase/companyData';

/**
 * Personalize a freshly-onboarded company's department/task text. Returns the number
 * of departments changed (0 if nothing was personalized), so the caller can re-render.
 */
export async function personalizeCompany(companyId: string, brief?: CompanyBrief): Promise<number> {
  try {
    const res = await fetch('/api/personalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ brief }),
    });
    if (!res.ok) return 0;
    const data = (await res.json()) as { departments?: PersonalizedDept[] };
    const generated = data.departments ?? [];
    if (!generated.length) return 0;

    const changed = applyPersonalization(generated);
    if (!changed.length) return 0;

    await persistPersonalization(companyId, changed).catch((err) => {
      // The in-memory merge already happened, so the user sees the personalized
      // company this session even if the write fails; it just won't persist.
      console.error('[personalize] persist failed', err);
    });
    return changed.length;
  } catch (err) {
    console.error('[personalize] failed', err);
    return 0;
  }
}
