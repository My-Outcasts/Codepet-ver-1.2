# Second Brain rebuild #1 (P0 event ledger + P1 derived graph) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the structured records Codepet already keeps into an append-only event ledger, derive a connected knowledge graph from it, and swap the Second Brain view onto that real graph — behind a feature flag.

**Architecture:** P0 adds a `companies/{cid}/events` subcollection written through at existing mutation points (client SDK) plus a one-time admin backfill route. P1 adds a pure `buildKnowledgeGraph(events, depts, roadmap)` function (mirrors `roadmapLayout.ts`), hydrates `events` into the store, and swaps `OverviewView`'s data builder behind `NEXT_PUBLIC_SECOND_BRAIN_V2`. The 3D `ForceGraph3D` + bloom renderer is untouched.

**Tech Stack:** TypeScript, Next.js App Router, Firebase (client SDK for writes/reads, admin SDK for backfill), `react-force-graph-3d` + three.js, Vitest.

## Global Constraints

- Test runner: `npx vitest run <file>` (single file), `npm test` (all). Import `{ describe, it, expect }` from `vitest`.
- Firestore client writes use `getDb()` + `addDoc`/`setDoc` (pattern: `persistChatMessage` in `lib/firebase/companyData.ts`). The `events` subcollection is already covered by the catch-all rule in `firestore.rules:84-92` — **no rules change needed**.
- API routes authenticate via `verifyIdToken` on a `Bearer` token and read/write with `adminDb()` (pattern: `app/api/remember/route.ts`).
- Pure layout/derivation libs live in `lib/overview/` and follow `roadmapLayout.ts`: no side effects, fully unit-tested.
- **Ownership boundary:** never modify `trackEvents`, `/api/track`, or Build Coach hooks. The ledger only **reads** `trackEvents`.
- All ledger emits are **fail-open**: a failed write must be swallowed (log only) and never block the main flow.
- Feature flag: `NEXT_PUBLIC_SECOND_BRAIN_V2` (client-readable). Off → today's static builder; on → derived graph.
- Existing graph types live in `components/views/OverviewView.tsx`: `GNode` (`id,name,kind,color,val,x,y,z,...`), `GLink` (`source,target,color,hex,kind,active?`).

---

## Task 1: Ledger types + paths

**Files:**

- Modify: `lib/firebase/schema.ts:153-173` (add `events`/`event` paths + `LedgerEvent` type)

**Interfaces:**

- Produces:
  - `paths.events(companyId: string): string` → `companies/{companyId}/events`
  - `paths.event(companyId: string, eventId: string): string`
  - `interface LedgerEvent { ts: number; type: LedgerEventType; actor: 'byte'|'founder'; deptK?: string; refType?: string; refId?: string; title: string; summary: string }`
  - `type LedgerEventType = 'deliverable_approved'|'decision_made'|'fact_remembered'|'task_run'|'build_session'|'toolkit_used'|'stage_advanced'`

- [ ] **Step 1: Add the paths**

In `lib/firebase/schema.ts`, inside the `paths` object (after the `trackEvent` entry, line ~164):

```ts
  events: (companyId: string) => `companies/${companyId}/events`,
  event: (companyId: string, eventId: string) => `companies/${companyId}/events/${eventId}`,
```

- [ ] **Step 2: Add the LedgerEvent type**

In `lib/firebase/schema.ts`, above `export const paths` (line ~153):

```ts
export type LedgerEventType =
  | 'deliverable_approved'
  | 'decision_made'
  | 'fact_remembered'
  | 'task_run'
  | 'build_session'
  | 'toolkit_used'
  | 'stage_advanced';

export interface LedgerEvent {
  ts: number; // ms epoch — the timestamp missing from done/drafted booleans today
  type: LedgerEventType;
  actor: 'byte' | 'founder';
  deptK?: string; // owning department key
  refType?: string; // 'library' | 'decision' | 'trackEvent' | 'task' | 'fact' | 'stage'
  refId?: string; // pointer back to the source record
  title: string; // short human line
  summary: string; // one sentence — reserved for P2 embedding & recall
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no new errors)

- [ ] **Step 4: Commit**

```bash
git add lib/firebase/schema.ts
git commit -m "feat(second-brain): LedgerEvent type + events collection paths"
```

---

## Task 2: Pure event builders + deterministic id

**Files:**

- Create: `lib/overview/ledger.ts`
- Test: `lib/overview/ledger.test.ts`

**Interfaces:**

- Consumes: `LedgerEvent`, `LedgerEventType` from `@/lib/firebase/schema`; `LibItem`, `Dept`, `Task` from `@/lib/data`; `DecisionEntry` from `@/lib/ai/projectModel`.
- Produces:
  - `eventKey(refType: string, refId: string): string` — deterministic, filesystem/Firestore-safe doc id used for idempotent backfill.
  - `eventFromLibItem(item: LibItem, deptK?: string): LedgerEvent`
  - `eventFromDecision(d: DecisionEntry, index: number): LedgerEvent`
  - `eventFromTaskDone(deptK: string, deptName: string, task: Task, ts: number): LedgerEvent`
  - `eventFromStageAdvance(stage: number, stageName: string, ts: number): LedgerEvent`

- [ ] **Step 1: Write the failing test**

`lib/overview/ledger.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { eventKey, eventFromTaskDone, eventFromStageAdvance } from './ledger';

describe('eventKey', () => {
  it('is deterministic and Firestore-safe (no slashes)', () => {
    expect(eventKey('library', 'abc/123')).toBe(eventKey('library', 'abc/123'));
    expect(eventKey('library', 'abc/123')).not.toContain('/');
    expect(eventKey('library', 'a')).not.toBe(eventKey('decision', 'a'));
  });
});

describe('eventFromTaskDone', () => {
  it('produces a task_run event carrying dept, ts, and a summary', () => {
    const e = eventFromTaskDone('eng', 'Engineering', { t: 'Ship b12', done: true } as any, 1000);
    expect(e.type).toBe('task_run');
    expect(e.deptK).toBe('eng');
    expect(e.ts).toBe(1000);
    expect(e.title).toContain('Ship b12');
    expect(e.summary.length).toBeGreaterThan(0);
  });
});

describe('eventFromStageAdvance', () => {
  it('produces a stage_advanced event with founder actor', () => {
    const e = eventFromStageAdvance(2, 'Launch', 5000);
    expect(e.type).toBe('stage_advanced');
    expect(e.actor).toBe('founder');
    expect(e.refType).toBe('stage');
    expect(e.refId).toBe('2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/overview/ledger.test.ts`
Expected: FAIL ("Cannot find module './ledger'")

- [ ] **Step 3: Write the implementation**

`lib/overview/ledger.ts`:

```ts
import type { LedgerEvent } from '@/lib/firebase/schema';
import type { LibItem, Task } from '@/lib/data';
import type { DecisionEntry } from '@/lib/ai/projectModel';

/** Deterministic, Firestore-safe doc id so backfill re-runs overwrite instead of duplicate. */
export function eventKey(refType: string, refId: string): string {
  return `${refType}_${refId}`.replace(/[^a-zA-Z0-9_-]/g, '-');
}

export function eventFromLibItem(item: LibItem, deptK?: string): LedgerEvent {
  return {
    ts: (item as any).createdAt ?? 0,
    type: 'deliverable_approved',
    actor: 'byte',
    deptK,
    refType: 'library',
    refId: item.id,
    title: item.title ?? 'Deliverable',
    summary: `Approved deliverable: ${item.title ?? 'untitled'}.`,
  };
}

export function eventFromDecision(d: DecisionEntry, index: number): LedgerEvent {
  const text = (d as any).text ?? (d as any).decision ?? String(d);
  return {
    ts: (d as any).ts ?? (d as any).at ?? 0,
    type: 'decision_made',
    actor: 'byte',
    refType: 'decision',
    refId: String((d as any).id ?? index),
    title: text.slice(0, 80),
    summary: `Decision: ${text}`,
  };
}

export function eventFromTaskDone(
  deptK: string,
  deptName: string,
  task: Task,
  ts: number,
): LedgerEvent {
  return {
    ts,
    type: 'task_run',
    actor: 'founder',
    deptK,
    refType: 'task',
    refId: `${deptK}:${task.t}`,
    title: task.t,
    summary: `Completed "${task.t}" in ${deptName}.`,
  };
}

export function eventFromStageAdvance(stage: number, stageName: string, ts: number): LedgerEvent {
  return {
    ts,
    type: 'stage_advanced',
    actor: 'founder',
    refType: 'stage',
    refId: String(stage),
    title: `Advanced to ${stageName}`,
    summary: `Company advanced to stage: ${stageName}.`,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/overview/ledger.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Typecheck & commit**

Run: `npx tsc --noEmit` → PASS

```bash
git add lib/overview/ledger.ts lib/overview/ledger.test.ts
git commit -m "feat(second-brain): pure event builders + deterministic event key"
```

---

## Task 3: Client-side appendEvent + hydrate events into store data

**Files:**

- Modify: `lib/firebase/companyData.ts` (add `appendEvent`, load events in `loadCompanyData`)
- Modify: `lib/firebase/companyData.ts:153-227` (`CompanyData` interface + `loadCompanyData` return)

**Interfaces:**

- Consumes: `paths.events`, `paths.event`, `LedgerEvent` from Task 1; `eventKey` from Task 2.
- Produces:
  - `appendEvent(companyId: string, event: LedgerEvent): Promise<void>` — fail-open client write via `setDoc` using a deterministic id from `eventKey(refType, refId)` (falls back to `addDoc` when no ref).
  - `loadCompanyData(...)` return gains `events: LedgerEvent[]`.

- [ ] **Step 1: Add `appendEvent`**

In `lib/firebase/companyData.ts`, near `persistChatMessage`:

```ts
import { eventKey } from '@/lib/overview/ledger';
// (ensure LedgerEvent is imported from '@/lib/firebase/schema' and addDoc from 'firebase/firestore')

/** Append a ledger event. Idempotent when the event has refType+refId; fail-open. */
export async function appendEvent(companyId: string, event: LedgerEvent): Promise<void> {
  try {
    const db = getDb();
    if (event.refType && event.refId) {
      await setDoc(doc(db, paths.event(companyId, eventKey(event.refType, event.refId))), event);
    } else {
      await addDoc(collection(db, paths.events(companyId)), event);
    }
  } catch (err) {
    console.warn('[second-brain] appendEvent failed (ignored)', err);
  }
}
```

- [ ] **Step 2: Load events in `loadCompanyData`**

Add `events: LedgerEvent[]` to the `CompanyData` interface (line ~153). In `loadCompanyData` (line ~192), add to the parallel reads and map:

```ts
// inside the Promise.all([...]) array:
getDocs(query(collection(db, paths.events(companyId)), orderBy('ts', 'desc'))),
```

Destructure the new snapshot (e.g. `eventsSnap`) and build:

```ts
const events = eventsSnap.docs.map((d) => d.data() as LedgerEvent);
```

Add `events` to the returned object.

- [ ] **Step 3: Add a smoke test for the return shape**

`lib/firebase/companyData.events.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { eventKey } from '@/lib/overview/ledger';

describe('appendEvent id strategy', () => {
  it('derives a stable id from refType+refId', () => {
    expect(eventKey('task', 'eng:Ship b12')).toBe(eventKey('task', 'eng:Ship b12'));
  });
});
```

Run: `npx vitest run lib/firebase/companyData.events.test.ts` → PASS

- [ ] **Step 4: Typecheck & commit**

Run: `npx tsc --noEmit` → PASS

```bash
git add lib/firebase/companyData.ts lib/firebase/companyData.events.test.ts
git commit -m "feat(second-brain): client appendEvent + hydrate events in loadCompanyData"
```

---

## Task 4: Store — hold events + write-through emits

**Files:**

- Modify: `lib/store.tsx` (add `events` state + hydrate; emit at task-done ~1325, `advanceStage` ~1094, after `/api/remember` success ~1780)

**Interfaces:**

- Consumes: `appendEvent` (Task 3), `eventFromTaskDone`/`eventFromStageAdvance` (Task 2), `events` from `loadCompanyData` (Task 3).
- Produces: `events: LedgerEvent[]` on the store context value (read by `OverviewView` in Task 7).

- [ ] **Step 1: Add events state + hydrate**

Near `const [library, setLibrary] = useState<LibItem[]>([]);` (line ~419):

```ts
const [events, setEvents] = useState<LedgerEvent[]>([]);
```

In the `loadCompanyData(...).then(({ ... })` destructure (line ~625), add `events: loadedEvents` and set it:

```ts
setEvents(loadedEvents ?? []);
```

- [ ] **Step 2: Emit on task done**

At `lib/store.tsx:1325` where `t.done = true;` is set, after the existing state write, emit (fail-open, non-blocking):

```ts
if (companyId) {
  const ts = Date.now();
  const ev = eventFromTaskDone(d.k, d.name, t, ts);
  void appendEvent(companyId, ev);
  setEvents((prev) => [ev, ...prev.filter((e) => e.refId !== ev.refId)]);
}
```

(Use the actual in-scope dept/task variable names at that site — `d`/`t` per the surrounding code.)

- [ ] **Step 3: Emit on advanceStage**

In `advanceStage` (`lib/store.tsx:1094`), after the stage increments, emit:

```ts
if (companyId) {
  const ts = Date.now();
  const ev = eventFromStageAdvance(newStage, nextPhaseName(newStage), ts);
  void appendEvent(companyId, ev);
  setEvents((prev) => [ev, ...prev.filter((e) => e.refId !== ev.refId)]);
}
```

(Use the stage value computed in that function; import `nextPhaseName` if not already in scope — it is used in `OverviewView`.)

- [ ] **Step 4: Emit after a successful remember**

At `lib/store.tsx:~1780` (where a "Noted" chip is folded into decisions after `/api/remember` returns), emit a `fact_remembered`/`decision_made` event per new decision using `eventFromDecision(dec, i)` + `appendEvent`. Keep it inside the existing success branch so it only fires when remember succeeded.

- [ ] **Step 5: Expose `events` on the context**

Add `events` to the context value object(s) (the store exposes two value literals — lines ~2172 and ~2281; add `events` to both) and to the context TypeScript interface (near `library: LibItem[];` at line ~233):

```ts
events: LedgerEvent[];
```

- [ ] **Step 6: Typecheck & commit**

Run: `npx tsc --noEmit` → PASS
Run: `npm test` → PASS (no regressions)

```bash
git add lib/store.tsx
git commit -m "feat(second-brain): store holds events + write-through emits (task/stage/remember)"
```

---

## Task 5: Backfill route (admin, idempotent)

**Files:**

- Create: `app/api/second-brain/backfill/route.ts`

**Interfaces:**

- Consumes: `verifyIdToken`, `adminDb` from `@/lib/firebase/admin`; `paths` from `@/lib/firebase/schema`; `eventKey`, `eventFromLibItem`, `eventFromDecision` from Task 2.
- Produces: `POST /api/second-brain/backfill` → `{ backfilled: number, skipped: boolean }`.

- [ ] **Step 1: Write the route**

`app/api/second-brain/backfill/route.ts`:

```ts
import { verifyIdToken, adminDb } from '@/lib/firebase/admin';
import { paths } from '@/lib/firebase/schema';
import { eventKey, eventFromLibItem, eventFromDecision } from '@/lib/overview/ledger';
import type { LedgerEvent } from '@/lib/firebase/schema';

export async function POST(req: Request) {
  const authz = req.headers.get('authorization') ?? '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  if (!idToken) return Response.json({ error: 'unauthorized' }, { status: 401 });

  let uid: string;
  try {
    uid = (await verifyIdToken(idToken)).uid;
  } catch {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = adminDb();
  const companyRef = db.doc(paths.company(uid));
  const companySnap = await companyRef.get();
  if (companySnap.get('secondBrainBackfilledAt')) {
    return Response.json({ backfilled: 0, skipped: true });
  }

  const events: LedgerEvent[] = [];
  const libSnap = await db.collection(paths.library(uid)).get();
  libSnap.forEach((d) => events.push(eventFromLibItem({ id: d.id, ...d.data() } as any)));
  const decisions = (companySnap.get('decisions') as any[]) ?? [];
  decisions.forEach((dec, i) => events.push(eventFromDecision(dec, i)));

  const batch = db.batch();
  for (const ev of events) {
    const id = eventKey(ev.refType ?? 'x', ev.refId ?? String(ev.ts));
    batch.set(db.doc(paths.event(uid, id)), ev);
  }
  batch.set(companyRef, { secondBrainBackfilledAt: Date.now() }, { merge: true });
  await batch.commit();

  return Response.json({ backfilled: events.length, skipped: false });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` → PASS

- [ ] **Step 3: Manual verification (documented, run once against a real account)**

From the app (authenticated), call the route with the user's ID token and confirm `companies/{uid}/events` is populated and a second call returns `{ skipped: true }`. Record the result in the PR description.

- [ ] **Step 4: Commit**

```bash
git add app/api/second-brain/backfill/route.ts
git commit -m "feat(second-brain): idempotent backfill route (library + decisions -> events)"
```

---

## Task 6: Pure knowledge-graph builder

**Files:**

- Create: `lib/overview/knowledgeGraph.ts`
- Test: `lib/overview/knowledgeGraph.test.ts`

**Interfaces:**

- Consumes: `LedgerEvent` from `@/lib/firebase/schema`; `Dept` from `@/lib/data`.
- Produces:
  - `type KGNodeKind = 'company'|'department'|'milestone'|'deliverable'|'decision'|'fact'|'session'|'task'`
  - `interface KGNode { id: string; name: string; kind: KGNodeKind; weight: number; deptK?: string; refType?: string; refId?: string; ts?: number }`
  - `interface KGEdge { source: string; target: string; kind: 'belongs_to'|'produced'|'advances'|'depends_on'|'references'|'supersedes'|'grounds'|'spine' }`
  - `buildKnowledgeGraph(events: LedgerEvent[], depts: Dept[]): { nodes: KGNode[]; edges: KGEdge[] }`

- [ ] **Step 1: Write the failing test**

`lib/overview/knowledgeGraph.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildKnowledgeGraph } from './knowledgeGraph';
import type { LedgerEvent } from '@/lib/firebase/schema';

const depts = [
  { k: 'eng', name: 'Engineering', tasks: [], status: 'idle' },
  { k: 'mkt', name: 'Marketing', tasks: [], status: 'idle' },
] as any;

const events: LedgerEvent[] = [
  {
    ts: 3,
    type: 'deliverable_approved',
    actor: 'byte',
    deptK: 'eng',
    refType: 'library',
    refId: 'L1',
    title: 'API v1',
    summary: 'Approved API v1.',
  },
  {
    ts: 2,
    type: 'decision_made',
    actor: 'byte',
    refType: 'decision',
    refId: 'D1',
    title: 'Use Voyage',
    summary: 'Decision: use Voyage.',
  },
  {
    ts: 1,
    type: 'stage_advanced',
    actor: 'founder',
    refType: 'stage',
    refId: '1',
    title: 'Launch',
    summary: 'Advanced to Launch.',
  },
];

describe('buildKnowledgeGraph', () => {
  it('always emits a company spine node + one node per department', () => {
    const { nodes } = buildKnowledgeGraph([], depts);
    expect(nodes.find((n) => n.kind === 'company')).toBeTruthy();
    expect(nodes.filter((n) => n.kind === 'department')).toHaveLength(2);
  });

  it('creates a deliverable node linked to its department via belongs_to', () => {
    const { nodes, edges } = buildKnowledgeGraph(events, depts);
    const deliverable = nodes.find((n) => n.kind === 'deliverable');
    expect(deliverable).toBeTruthy();
    expect(
      edges.some(
        (e) => e.kind === 'belongs_to' && e.source === deliverable!.id && e.target === 'dept:eng',
      ),
    ).toBe(true);
  });

  it('weights a referenced node higher than an unreferenced one', () => {
    const { nodes } = buildKnowledgeGraph(events, depts);
    const dept = nodes.find((n) => n.id === 'dept:eng')!;
    const mkt = nodes.find((n) => n.id === 'dept:mkt')!;
    expect(dept.weight).toBeGreaterThan(mkt.weight); // eng owns a deliverable
  });

  it('is a pure function (same input -> equal output)', () => {
    expect(buildKnowledgeGraph(events, depts)).toEqual(buildKnowledgeGraph(events, depts));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/overview/knowledgeGraph.test.ts`
Expected: FAIL ("Cannot find module './knowledgeGraph'")

- [ ] **Step 3: Write the implementation**

`lib/overview/knowledgeGraph.ts`:

```ts
import type { LedgerEvent } from '@/lib/firebase/schema';
import type { Dept } from '@/lib/data';

export type KGNodeKind =
  'company' | 'department' | 'milestone' | 'deliverable' | 'decision' | 'fact' | 'session' | 'task';

export interface KGNode {
  id: string;
  name: string;
  kind: KGNodeKind;
  weight: number;
  deptK?: string;
  refType?: string;
  refId?: string;
  ts?: number;
}

export interface KGEdge {
  source: string;
  target: string;
  kind:
    | 'belongs_to'
    | 'produced'
    | 'advances'
    | 'depends_on'
    | 'references'
    | 'supersedes'
    | 'grounds'
    | 'spine';
}

const KIND_OF: Partial<Record<LedgerEvent['type'], KGNodeKind>> = {
  deliverable_approved: 'deliverable',
  decision_made: 'decision',
  fact_remembered: 'fact',
  task_run: 'task',
  build_session: 'session',
  stage_advanced: 'milestone',
};

const EDGE_OF: Partial<Record<LedgerEvent['type'], KGEdge['kind']>> = {
  deliverable_approved: 'belongs_to',
  task_run: 'produced',
  stage_advanced: 'advances',
  fact_remembered: 'grounds',
};

/** Recency component: newer events weigh more, decaying over rank. */
function recencyWeight(rank: number, total: number): number {
  return total <= 1 ? 1 : 1 - rank / total;
}

export function buildKnowledgeGraph(
  events: LedgerEvent[],
  depts: Dept[],
): { nodes: KGNode[]; edges: KGEdge[] } {
  const nodes: KGNode[] = [];
  const edges: KGEdge[] = [];
  const inDegree = new Map<string, number>();
  const bump = (id: string) => inDegree.set(id, (inDegree.get(id) ?? 0) + 1);

  // Spine: company + departments
  nodes.push({ id: 'company', name: 'Your company', kind: 'company', weight: 10 });
  for (const d of depts) {
    const id = `dept:${d.k}`;
    nodes.push({ id, name: d.name, kind: 'department', weight: 1, deptK: d.k });
    edges.push({ source: 'company', target: id, kind: 'spine' });
  }
  const deptIds = new Set(depts.map((d) => `dept:${d.k}`));

  // Knowledge nodes from the ledger (newest first for recency)
  const sorted = [...events].sort((a, b) => b.ts - a.ts);
  sorted.forEach((ev, i) => {
    const kind = KIND_OF[ev.type];
    if (!kind) return;
    const id = `ev:${ev.refType ?? ev.type}:${ev.refId ?? ev.ts}`;
    if (nodes.some((n) => n.id === id)) return; // dedupe
    nodes.push({
      id,
      name: ev.title,
      kind,
      weight: recencyWeight(i, sorted.length),
      deptK: ev.deptK,
      refType: ev.refType,
      refId: ev.refId,
      ts: ev.ts,
    });
    const target = ev.deptK && deptIds.has(`dept:${ev.deptK}`) ? `dept:${ev.deptK}` : 'company';
    edges.push({ source: id, target, kind: EDGE_OF[ev.type] ?? 'references' });
    bump(target);
  });

  // Fold reference count into node weight (this is what makes the galaxy uneven)
  for (const n of nodes) n.weight += inDegree.get(n.id) ?? 0;

  return { nodes, edges };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/overview/knowledgeGraph.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Typecheck & commit**

Run: `npx tsc --noEmit` → PASS

```bash
git add lib/overview/knowledgeGraph.ts lib/overview/knowledgeGraph.test.ts
git commit -m "feat(second-brain): pure ledger->knowledge-graph builder + tests"
```

---

## Task 7: Swap OverviewView's data builder behind the flag

**Files:**

- Modify: `components/views/OverviewView.tsx` (extend `GNode.kind`/`GLink.kind`; add a flagged branch that maps `buildKnowledgeGraph` output into `GNode`/`GLink`; consume `events` from store)

**Interfaces:**

- Consumes: `buildKnowledgeGraph`, `KGNode`, `KGEdge` (Task 6); `events` from store (Task 4).
- Produces: unchanged render contract — `{ data: { nodes: GNode[]; links: GLink[] }, adj }` from the existing `useMemo`.

- [ ] **Step 1: Extend the graph types**

In `components/views/OverviewView.tsx`, widen `GNode.kind` (line ~72) and `GLink.kind` (line ~93):

```ts
kind: 'project' |
  'dept' |
  'task' |
  'company' |
  'department' |
  'milestone' |
  'deliverable' |
  'decision' |
  'fact' |
  'session';
// GLink:
kind: 'pd' |
  'dt' |
  'belongs_to' |
  'produced' |
  'advances' |
  'depends_on' |
  'references' |
  'supersedes' |
  'grounds' |
  'spine';
```

- [ ] **Step 2: Add a flagged v2 builder branch**

At the top of the `const { data, adj } = useMemo(() => {` block (line ~250), add:

```ts
const V2 = process.env.NEXT_PUBLIC_SECOND_BRAIN_V2 === '1';
if (V2) {
  const kg = buildKnowledgeGraph(events, DEPTS);
  const nodes: GNode[] = kg.nodes.map((n, i) => {
    const yy = kg.nodes.length > 1 ? 1 - (i / (kg.nodes.length - 1)) * 2 : 0;
    const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
    const th = GOLDEN * i;
    const hex = KG_HEX[n.kind] ?? HEX['--accent'];
    return {
      id: n.id,
      name: n.name,
      kind: n.kind === 'company' ? 'project' : n.kind === 'department' ? 'dept' : n.kind,
      color: rgba(hex, 0.9),
      val: 0.7 + n.weight,
      deptColor: hex,
      x: n.kind === 'company' ? 0 : Math.cos(th) * rr * DEPT_R,
      y: n.kind === 'company' ? 0 : yy * DEPT_R,
      z: n.kind === 'company' ? 0 : Math.sin(th) * rr * DEPT_R,
    } as GNode;
  });
  const links: GLink[] = kg.edges.map((e) => ({
    source: e.source,
    target: e.target,
    color: rgba(HEX['--accent'], 0.25),
    hex: HEX['--accent'],
    kind: e.kind,
  }));
  const adj = new Map<string, Set<string>>();
  links.forEach((l) => {
    if (!adj.has(linkId(l.source))) adj.set(linkId(l.source), new Set());
    if (!adj.has(linkId(l.target))) adj.set(linkId(l.target), new Set());
    adj.get(linkId(l.source))!.add(linkId(l.target));
    adj.get(linkId(l.target))!.add(linkId(l.source));
  });
  return { data: { nodes, links }, adj };
}
// ...existing static builder unchanged below...
```

Add a color map near the other `HEX` constants (line ~35):

```ts
const KG_HEX: Record<string, string> = {
  deliverable: HEX['--accent'] ?? '#B49CF5',
  decision: '#7DE3FF',
  fact: '#9AE6B4',
  session: '#F6AD55',
  milestone: '#F687B3',
};
```

Add `events` to the `useMemo` dependency array and pull `events` from the store hook near the other store reads at the top of the component.

- [ ] **Step 3: Node click routes to the source record**

In the existing node-click handler, when `V2` and the node has `refType`, route to the source (deliverable → library item, decision → decisions view) reusing the current view-navigation actions. For kinds without a target, keep today's focus-on-node behavior. (Use the existing `setView`/detail action already imported in this file.)

- [ ] **Step 4: Manual verification**

Run: `NEXT_PUBLIC_SECOND_BRAIN_V2=1 npm run dev`, open Second Brain. Expected: galaxy shows company + departments + deliverable/decision/milestone dots with cross-links; clicking a deliverable opens its library item. With the flag unset, the view is byte-for-byte today's static graph.

- [ ] **Step 5: Typecheck, test, commit**

Run: `npx tsc --noEmit` → PASS
Run: `npm test` → PASS

```bash
git add components/views/OverviewView.tsx
git commit -m "feat(second-brain): flag-gated knowledge-graph builder in OverviewView"
```

---

## Task 8: Empty-state + flag documentation

**Files:**

- Modify: `components/views/OverviewView.tsx` (empty-state copy when `V2` and `events.length === 0`)
- Modify: `.env.example` (document the flag)

**Interfaces:**

- Consumes: `events` (Task 4), `V2` branch (Task 7).

- [ ] **Step 1: Empty-state**

In the `V2` branch, when `events.length === 0`, still render the spine (company + departments) and surface a one-line invitation in the existing header/callout area: "Your Second Brain fills in as you and byte work — approve a deliverable or lock a decision to see it here." (Reuse the existing callout element; do not add a blank screen.)

- [ ] **Step 2: Document the flag**

Add to `.env.example`:

```
# Second Brain rebuild (P0/P1): render the derived knowledge graph instead of the static tree
NEXT_PUBLIC_SECOND_BRAIN_V2=0
```

- [ ] **Step 3: Typecheck & commit**

Run: `npx tsc --noEmit` → PASS

```bash
git add components/views/OverviewView.tsx .env.example
git commit -m "feat(second-brain): empty-state for new accounts + document the flag"
```

---

## Final verification

- [ ] Run full suite: `npm test` → PASS
- [ ] `npx tsc --noEmit` → PASS
- [ ] `npm run lint` → PASS
- [ ] Manual: flag off → view unchanged; flag on → real galaxy, click-through works, new account shows empty-state.

---

## Self-review notes (spec coverage)

- P0 schema (§2.1) → Task 1. Writer (§2.2) → Task 3 (client SDK per repo pattern; the spec's "mirror serverDecisions" was a shape guide — the established store-write pattern is client SDK, admin only for the bulk backfill). Write-through (§2.3) → Task 4. Backfill (§2.4) → Task 5.
- P1 pure builder (§3) → Task 6. View swap + detail panel + aesthetic (§4) → Task 7. Feature flag (§4.1) → Tasks 7–8. Empty-state (§4 pt 4) → Task 8.
- Testing (§5) → Tasks 2, 3, 6 (unit) + manual steps in Tasks 5, 7.
- Non-goals honored: no embeddings/recall (deferred), no `trackEvents` mutation (backfill reads only; build-session emit deferred to when a read-only tap is added — not in these tasks), renderer untouched.
- **Deviation logged:** build-session events from `trackEvents` are read-only and deferred out of these 8 tasks to keep P0 within the client-write pattern; the `session` node kind exists in the builder for when that read tap lands. Flagged for the reviewer.
