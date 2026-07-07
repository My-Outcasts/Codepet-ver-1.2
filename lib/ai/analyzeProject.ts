'use client';
// Client side of the one-time project analysis: POST the brief to /api/project-analysis
// and return a validated ProjectAnalysis (or null). Persisting + state live in the store
// (which owns projectAnalysis), so this helper only fetches + validates. Best-effort:
// any failure returns null and the caller keeps the fallback intro.
import { authHeader } from './runTask';
import { isUsableAnalysis, type ProjectAnalysis } from './projectAnalysis';
import type { CompanyBrief } from '../firebase/schema';

export async function fetchProjectAnalysis(brief?: CompanyBrief): Promise<ProjectAnalysis | null> {
  try {
    const res = await fetch('/api/project-analysis', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ brief }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    return isUsableAnalysis(data) ? data : null;
  } catch (err) {
    console.error('[project-analysis] failed', err);
    return null;
  }
}
