// Phase 6.4 — per-user daily usage counter, written over Firestore REST authorized
// by the caller's OWN Firebase ID token (same trust model as serverBrief.ts: no
// service account, subject to the existing security rules). The counter lives at
//   companies/{uid}/usage/{yyyy-mm-dd}   field `n`
// which the owner-subcollection rule already permits — so this needs NO change to
// the shared devpet-8f4b1 rules.
//
// A single atomic `:commit` with an increment transform bumps the day's count and
// returns the post-increment value, so one round-trip both records the attempt and
// tells us where the user stands. Fail-open: any network/permission error returns
// null so the route lets the generation through — a transient Firestore blip must
// never break a paid feature. Server-only (no 'use client').
import { dayKey, overDailyLimit, resolveDailyLimit } from '@/lib/ai/rateLimit';

function projectId(): string | null {
  return process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || null;
}

/**
 * Atomically increment the caller's usage count for the current UTC day and return
 * the new running total. Returns null if usage can't be recorded (misconfig, network,
 * or rules) — callers treat null as "don't block" (fail open).
 */
export async function bumpDailyUsage(uid: string, idToken: string, now: Date): Promise<number | null> {
  const pid = projectId();
  if (!pid) return null;
  const doc = `projects/${pid}/databases/(default)/documents/companies/${encodeURIComponent(uid)}/usage/${dayKey(now)}`;
  const url = `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents:commit`;
  const bodyReq = {
    writes: [
      {
        transform: {
          document: doc,
          fieldTransforms: [{ fieldPath: 'n', increment: { integerValue: '1' } }],
        },
      },
    ],
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(bodyReq),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      writeResults?: Array<{ transformResults?: Array<{ integerValue?: string }> }>;
    };
    const raw = json.writeResults?.[0]?.transformResults?.[0]?.integerValue;
    const n = raw != null ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export interface LimitDecision {
  ok: boolean;
  /** The running count after this attempt (undefined when the counter was unavailable). */
  count?: number;
  limit: number;
}

/**
 * Record this attempt and decide whether it's over the per-user daily cap. Fail-open:
 * if the counter can't be read/written, returns ok:true so generation proceeds.
 */
export async function enforceDailyLimit(
  uid: string,
  idToken: string,
  now: Date,
): Promise<LimitDecision> {
  const limit = resolveDailyLimit(process.env.AI_DAILY_LIMIT);
  const count = await bumpDailyUsage(uid, idToken, now);
  if (count == null) return { ok: true, limit }; // fail open
  return { ok: !overDailyLimit(count, limit), count, limit };
}
