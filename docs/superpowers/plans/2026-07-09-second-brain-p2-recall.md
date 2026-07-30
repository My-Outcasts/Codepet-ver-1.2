# Second Brain rebuild #2 (P2 recall) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add semantic recall over the event ledger — embed each event's summary, retrieve the nearest events for a query, and surface cited nodes via an "Ask your Second Brain" panel.

**Architecture:** A provider-agnostic embed seam (Voyage `voyage-3`) plus pure brute-force cosine retrieval. Vectors live on the event doc (`vec: number[]`). A server route lazily fills missing vectors; a recall route embeds a query and returns cited hits. Everything is inert without `SECOND_BRAIN_RECALL=1` + `VOYAGE_API_KEY`.

**Tech Stack:** TypeScript, Next.js App Router (Node runtime routes), Firebase admin SDK, Voyage embeddings REST, Vitest.

## Global Constraints

- Test runner: `npx vitest run <file>`. Import `{ describe, it, expect }` from `vitest`. Use **relative** imports in tests (`@/` is not resolved by vitest at runtime; type-only `@/` imports are fine).
- Server-only modules (hold keys / use admin SDK): no `'use client'`; pattern = `lib/ai/client.ts`, `app/api/remember/route.ts`.
- Feature gate: `isEmbedEnabled()` = `!!VOYAGE_API_KEY && SECOND_BRAIN_RECALL === '1'`. Both routes no-op (`{ enabled:false }`) when false. Never throw to the caller on a disabled/misconfigured feature.
- Voyage: `POST https://api.voyageai.com/v1/embeddings`, header `Authorization: Bearer $VOYAGE_API_KEY`, body `{ input: string[], model: 'voyage-3' }`, response `{ data: [{ embedding: number[] }] }`.
- Do not touch `trackEvents` / Build Coach. Recall is read-only over the ledger.
- **Scope note (deviation from spec §1.6):** the byte-chat `recall` tool is deferred to a follow-up (P2.1). The chat route streams and executes tools client-side (no server round-trip), so a proper recall round-trip does not fit without restructuring it. This plan ships the recall route + UI panel — the fully functional, user-facing recall — and leaves chat-tool wiring out. Flagged for the reviewer.

---

## Task 1: Vector field + embed seam

**Files:**

- Modify: `lib/firebase/schema.ts` (add `vec?: number[]` to `LedgerEvent`)
- Create: `lib/ai/embed.ts`

**Interfaces:**

- Produces:
  - `isEmbedEnabled(): boolean`
  - `embedTexts(texts: string[]): Promise<number[][]>` — throws if `VOYAGE_API_KEY` unset.

- [ ] **Step 1: Add the vector field**

In `lib/firebase/schema.ts`, in `interface LedgerEvent`, after `summary: string;`:

```ts
  vec?: number[]; // embedding of `summary` (P2 recall); absent until the embed route fills it
```

- [ ] **Step 2: Write the embed seam**

`lib/ai/embed.ts`:

```ts
// Server-only embedding seam (holds VOYAGE_API_KEY). Provider-agnostic surface so the rest
// of P2 (retrieval, routes) never imports Voyage directly. Inert unless the feature is on.
const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const MODEL = 'voyage-3';
const BATCH = 128;

export function isEmbedEnabled(): boolean {
  return !!process.env.VOYAGE_API_KEY && process.env.SECOND_BRAIN_RECALL === '1';
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error('VOYAGE_API_KEY not set');
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const input = texts.slice(i, i + BATCH);
    const res = await fetch(VOYAGE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ input, model: MODEL }),
    });
    if (!res.ok) throw new Error(`voyage ${res.status}`);
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    out.push(...json.data.map((d) => d.embedding));
  }
  return out;
}
```

- [ ] **Step 3: Typecheck & commit**

Run: `npx tsc --noEmit` → PASS (ignore stale `.next/*` errors)

```bash
git add lib/firebase/schema.ts lib/ai/embed.ts
git commit -m "feat(second-brain): vec field + provider-agnostic embed seam (Voyage)"
```

---

## Task 2: Pure retrieval (cosine + topK)

**Files:**

- Create: `lib/overview/recall.ts`
- Test: `lib/overview/recall.test.ts`

**Interfaces:**

- Produces:
  - `cosine(a: number[], b: number[]): number`
  - `interface RecallItem { refType?: string; refId?: string; title: string; summary: string; vec?: number[] }`
  - `topK(queryVec: number[], items: RecallItem[], k: number): Array<RecallItem & { score: number }>`

- [ ] **Step 1: Write the failing test**

`lib/overview/recall.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { cosine, topK } from './recall';

describe('cosine', () => {
  it('is 1 for identical, ~0 for orthogonal', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });
  it('is 0 when a vector is zero-length', () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe('topK', () => {
  const items = [
    { title: 'a', summary: 'a', vec: [1, 0] },
    { title: 'b', summary: 'b', vec: [0.9, 0.1] },
    { title: 'c', summary: 'c', vec: [0, 1] },
    { title: 'd', summary: 'd' }, // no vec — skipped
  ];
  it('ranks by cosine desc and limits to k', () => {
    const hits = topK([1, 0], items, 2);
    expect(hits.map((h) => h.title)).toEqual(['a', 'b']);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });
  it('skips items without a vector', () => {
    const hits = topK([1, 0], items, 10);
    expect(hits.find((h) => h.title === 'd')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/overview/recall.test.ts`
Expected: FAIL ("Cannot find module './recall'")

- [ ] **Step 3: Write the implementation**

`lib/overview/recall.ts`:

```ts
// Pure brute-force cosine retrieval — enough at one-founder scale (hundreds of events),
// no vector DB. No side effects, fully unit-tested with stub vectors.
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface RecallItem {
  refType?: string;
  refId?: string;
  title: string;
  summary: string;
  vec?: number[];
}

export function topK(
  queryVec: number[],
  items: RecallItem[],
  k: number,
): Array<RecallItem & { score: number }> {
  return items
    .filter((it) => Array.isArray(it.vec) && it.vec.length > 0)
    .map((it) => ({ ...it, score: cosine(queryVec, it.vec as number[]) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/overview/recall.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/overview/recall.ts lib/overview/recall.test.ts
git commit -m "feat(second-brain): pure cosine top-k retrieval + tests"
```

---

## Task 3: Embed route (fill missing vectors)

**Files:**

- Create: `app/api/second-brain/embed/route.ts`

**Interfaces:**

- Consumes: `verifyIdToken`, `adminDb` (`@/lib/firebase/admin`); `paths` (`@/lib/firebase/schema`); `isEmbedEnabled`, `embedTexts` (`@/lib/ai/embed`).
- Produces: `POST /api/second-brain/embed` → `{ enabled: boolean, embedded: number }`.

- [ ] **Step 1: Write the route**

`app/api/second-brain/embed/route.ts`:

```ts
import { verifyIdToken, adminDb } from '@/lib/firebase/admin';
import { paths } from '@/lib/firebase/schema';
import { isEmbedEnabled, embedTexts } from '@/lib/ai/embed';

export async function POST(req: Request) {
  const authz = req.headers.get('authorization') ?? '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  if (!idToken) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (!isEmbedEnabled()) return Response.json({ enabled: false, embedded: 0 });

  let uid: string;
  try {
    uid = (await verifyIdToken(idToken)).uid;
  } catch {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = adminDb();
  const snap = await db.collection(paths.events(uid)).get();
  const missing = snap.docs.filter((d) => !Array.isArray(d.get('vec')));
  if (missing.length === 0) return Response.json({ enabled: true, embedded: 0 });

  const vectors = await embedTexts(
    missing.map((d) => String(d.get('summary') ?? d.get('title') ?? '')),
  );
  const batch = db.batch();
  missing.forEach((d, i) => batch.set(d.ref, { vec: vectors[i] }, { merge: true }));
  await batch.commit();

  return Response.json({ enabled: true, embedded: missing.length });
}
```

- [ ] **Step 2: Typecheck & commit**

Run: `npx tsc --noEmit` → PASS

```bash
git add app/api/second-brain/embed/route.ts
git commit -m "feat(second-brain): embed route fills missing event vectors (idempotent)"
```

---

## Task 4: Recall route (query → cited hits)

**Files:**

- Create: `app/api/second-brain/recall/route.ts`

**Interfaces:**

- Consumes: `verifyIdToken`, `adminDb`; `paths`; `isEmbedEnabled`, `embedTexts`; `topK`, `RecallItem` (`@/lib/overview/recall`); `LedgerEvent` type.
- Produces: `POST /api/second-brain/recall` `{ query }` → `{ enabled, hits: Array<{refType, refId, title, summary, score}> }`.

- [ ] **Step 1: Write the route**

`app/api/second-brain/recall/route.ts`:

```ts
import { verifyIdToken, adminDb } from '@/lib/firebase/admin';
import { paths } from '@/lib/firebase/schema';
import type { LedgerEvent } from '@/lib/firebase/schema';
import { isEmbedEnabled, embedTexts } from '@/lib/ai/embed';
import { topK, type RecallItem } from '@/lib/overview/recall';

export async function POST(req: Request) {
  const authz = req.headers.get('authorization') ?? '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  if (!idToken) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (!isEmbedEnabled()) return Response.json({ enabled: false, hits: [] });

  let uid: string;
  try {
    uid = (await verifyIdToken(idToken)).uid;
  } catch {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { query } = (await req.json().catch(() => ({}))) as { query?: string };
  if (!query?.trim()) return Response.json({ enabled: true, hits: [] });

  const [qvec] = await embedTexts([query]);
  const db = adminDb();
  const snap = await db.collection(paths.events(uid)).get();
  const items: RecallItem[] = snap.docs.map((d) => {
    const e = d.data() as LedgerEvent;
    return { refType: e.refType, refId: e.refId, title: e.title, summary: e.summary, vec: e.vec };
  });
  const hits = topK(qvec, items, 6).map(({ refType, refId, title, summary, score }) => ({
    refType,
    refId,
    title,
    summary,
    score,
  }));
  return Response.json({ enabled: true, hits });
}
```

- [ ] **Step 2: Typecheck & commit**

Run: `npx tsc --noEmit` → PASS

```bash
git add app/api/second-brain/recall/route.ts
git commit -m "feat(second-brain): recall route — query -> cosine top-k cited hits"
```

---

## Task 5: "Ask your Second Brain" panel

**Files:**

- Modify: `components/views/OverviewView.tsx` (a small recall input + results list, behind `SECOND_BRAIN_V2`)
- Modify: `.env.example` (document `SECOND_BRAIN_RECALL` + `VOYAGE_API_KEY`)

**Interfaces:**

- Consumes: `POST /api/second-brain/recall`; the existing node-click routing (`refType==='library'` → `openDeliverable`).

- [ ] **Step 1: Add the panel**

In `OverviewView`, when `SECOND_BRAIN_V2`, render (in the header block, `pointerEvents:'auto'`) a
one-line input with an Ask button. On submit, get the auth token the same way the app's other
authed fetches do (reuse the existing helper used by `rememberApproval`/authed client calls — grep
`getIdToken`/`Authorization` in `lib/` to match the current pattern), POST `{ query }`, and render
`hits` as a short list. Each hit shows `title` + a truncated `summary`; clicking a hit with
`refType==='library'` finds the matching `library` item by title and calls `openDeliverable`,
otherwise focuses the node via `fitView()`. Keep local `useState` for `query`, `hits`, `loading`.
Empty/disabled response (`enabled:false` or no hits) shows a quiet "nothing yet" line — never an error.

- [ ] **Step 2: Document the flags**

Add to `.env.example`:

```
# Second Brain recall (P2). Server flag — with a Voyage key, byte can answer questions over the
# event ledger via semantic search. Inert unless BOTH are set.
SECOND_BRAIN_RECALL=0
# VOYAGE_API_KEY=
```

- [ ] **Step 3: Typecheck, lint, commit**

Run: `npx tsc --noEmit` → PASS; `npx eslint components/views/OverviewView.tsx` → 0 errors

```bash
git add components/views/OverviewView.tsx .env.example
git commit -m "feat(second-brain): Ask-your-Second-Brain recall panel + document flags"
```

---

## Final verification

- [ ] `npm test` → PASS (new: recall.test.ts)
- [ ] `npx tsc --noEmit` → PASS (ignore stale `.next/*`)
- [ ] `npm run lint` → 0 errors
- [ ] Manual (owner, once `SECOND_BRAIN_RECALL=1` + `VOYAGE_API_KEY` set): POST `/api/second-brain/embed`, then ask a known question in the panel; confirm cited nodes are relevant. With flags unset, routes return `{enabled:false}` and the panel shows the quiet empty state.

---

## Self-review notes

- Spec §1.1 embed seam → T1. §1.2 retrieval → T2. §1.3 vec field → T1. §1.4 embed route → T3. §1.5 recall route → T4. §1.7 panel → T5. §1.6 byte recall tool → **deferred (P2.1)**, see Global Constraints scope note.
- Gate (`isEmbedEnabled`) enforced in both routes (T3/T4); feature inert without key + flag.
- Tests avoid live Voyage calls (pure retrieval only); routes verified by the enabled/disabled gate + manual live check.
