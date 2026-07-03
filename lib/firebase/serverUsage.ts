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
import { after } from 'next/server';
import { dayKey, overDailyLimit, resolveDailyLimit } from '@/lib/ai/rateLimit';
import type { TokenUsage } from '@/lib/ai/client';

function projectId(): string | null {
  return process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || null;
}

function commitUrl(pid: string): string {
  return `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents:commit`;
}

function usageDoc(pid: string, uid: string, now: Date): string {
  return `projects/${pid}/databases/(default)/documents/companies/${encodeURIComponent(uid)}/usage/${dayKey(now)}`;
}

/**
 * Atomically increment the caller's usage count for the current UTC day and return
 * the new running total. Returns null if usage can't be recorded (misconfig, network,
 * or rules) — callers treat null as "don't block" (fail open).
 */
export async function bumpDailyUsage(
  uid: string,
  idToken: string,
  now: Date,
): Promise<number | null> {
  const pid = projectId();
  if (!pid) return null;
  const doc = usageDoc(pid, uid, now);
  const url = commitUrl(pid);
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

// Firestore field paths can't contain arbitrary characters, so reduce a route label
// (e.g. "run-task:post") to a bare alphanumeric key ("runtaskpost"). Routes pass clean
// keys already; this is the safety net so a stray label can never produce a bad path.
function safeRouteKey(raw: string): string {
  const k = raw.replace(/[^a-zA-Z0-9]/g, '');
  return k.length ? k : 'other';
}

/**
 * Accumulate one model call's token usage onto the caller's daily usage doc — the SAME
 * doc the rate-limit counter (`n`) lives in, so a day is one row per user. Adds token
 * totals under a `tok` map (in/out/cacheRead/cacheWrite/calls) and a per-route
 * breakdown under `route.{key}`. Increment transforms create the fields on first write.
 *
 * Best-effort telemetry: fail-open and never throws — a Firestore blip or a rules
 * rejection must never affect the response the user already received.
 */
export async function recordTokenUsage(
  uid: string,
  idToken: string,
  now: Date,
  usage: TokenUsage,
  routeKey: string,
): Promise<void> {
  const pid = projectId();
  if (!pid) return;
  const key = safeRouteKey(routeKey);
  // Non-negative integers only — a bad usage number must never poison the counter.
  const inc = (fieldPath: string, v: number) => ({
    fieldPath,
    increment: { integerValue: String(Math.max(0, Math.trunc(v))) },
  });
  const bodyReq = {
    writes: [
      {
        transform: {
          document: usageDoc(pid, uid, now),
          fieldTransforms: [
            inc('tok.in', usage.inputTokens),
            inc('tok.out', usage.outputTokens),
            inc('tok.cacheRead', usage.cacheReadTokens),
            inc('tok.cacheWrite', usage.cacheWriteTokens),
            inc('tok.calls', 1),
            inc(`route.${key}.in`, usage.inputTokens),
            inc(`route.${key}.out`, usage.outputTokens),
            inc(`route.${key}.calls`, 1),
          ],
        },
      },
    ],
  };
  try {
    await fetch(commitUrl(pid), {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(bodyReq),
    });
  } catch {
    // best-effort — swallow
  }
}

/**
 * Build a usage sink to hand to the AI client's `onUsage`. Recording must add zero
 * latency to the response and can never fail it, so the write is scheduled with Next's
 * `after()` — it runs once the response is sent, and the platform keeps the function
 * alive for it (reliable even on the non-streaming routes, where a bare floated promise
 * could be frozen at return). If `after()` is ever called outside a request scope it
 * throws; we fall back to a plain floated write (best-effort, same as before).
 *
 * `routeKey` should be a stable, readable name ('chat', 'runTask', 'scaffold',
 * 'nextStep', 'personalize').
 */
export function usageSink(
  uid: string,
  idToken: string,
  routeKey: string,
): (usage: TokenUsage) => void {
  return (usage) => {
    const write = () => recordTokenUsage(uid, idToken, new Date(), usage, routeKey);
    try {
      after(write);
    } catch {
      void write();
    }
  };
}
