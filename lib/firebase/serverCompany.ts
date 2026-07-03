// Server-side reader for the company fields byte grounds on — the brief and the
// maintained decisions — in ONE masked request to companies/{uid}, authorized by the
// caller's own Firebase ID token (same trust model as serverBrief). run-task and chat
// use this instead of loadServerBrief so they don't read the same doc twice; personalize
// and next-step keep the brief-only loader. Server-only (no 'use client').
import { fsToJs, getProjectId, type FsValue } from './firestoreRest';
import { normalizeDecisions, type DecisionEntry } from '@/lib/ai/projectModel';

export interface ServerCompany {
  /** The persisted onboarding brief (raw — composed via briefToContext downstream). */
  brief: unknown;
  /** The founder's locked-in decisions, validated and capped. */
  decisions: DecisionEntry[];
}

/**
 * Load the `brief` and `decisions` fields of companies/{uid} in a single request.
 * Fail-open: any misconfig / network / rules error yields empty values so grounding is
 * simply thinner and generation still proceeds.
 */
export async function loadServerCompany(uid: string, idToken: string): Promise<ServerCompany> {
  const pid = getProjectId();
  if (!pid) return { brief: null, decisions: [] };
  const url =
    `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/companies/${encodeURIComponent(uid)}` +
    `?mask.fieldPaths=brief&mask.fieldPaths=decisions`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
    if (!res.ok) return { brief: null, decisions: [] };
    const json = (await res.json()) as { fields?: { brief?: FsValue; decisions?: FsValue } };
    return {
      brief: fsToJs(json.fields?.brief) ?? null,
      decisions: normalizeDecisions(fsToJs(json.fields?.decisions)),
    };
  } catch {
    return { brief: null, decisions: [] };
  }
}
