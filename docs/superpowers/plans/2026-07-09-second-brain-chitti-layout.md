# Second Brain #4 (Chitti-style layout) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Turn the Second Brain (Overview when `NEXT_PUBLIC_SECOND_BRAIN_V2`) into a Chitti-style 3-column layout — byte chat left, knowledge galaxy center, real-data info rail right.

**Architecture:** Additive, flag-gated. Phase 1 adds a right info rail (`SecondBrainPanel`) fed by pure stat helpers. Phase 2 wraps the view in a 3-column grid and reuses `Copilot` inline on the left. Phase 3 densifies the galaxy. Renderer unchanged.

**Tech Stack:** React, Next.js, existing `react-force-graph-3d`, Vitest.

## Global Constraints

- Test runner `npx vitest run <file>`; tests use **relative** imports. Type-only `@/` imports are fine.
- All new UI gated behind `SECOND_BRAIN_V2` (already read in `OverviewView.tsx`). Flag off = unchanged Overview.
- Rail content derives from existing store state only (`events`, `nextStep`, `tracking`, `companionId`, `DEPTS`) — no new backend.
- Real data only — no Chitti capture sources (Files/Web/Browser/Screen), no voice/orb.
- Model constant: display `claude-opus-4-8` for BRAIN (matches the session model id family).

---

## Phase 1 · Right info rail

### Task 1: Pure stat helpers

**Files:** Create `lib/overview/secondBrainStats.ts`, `lib/overview/secondBrainStats.test.ts`

**Interfaces:**

- `ledgerCounts(events: LedgerEvent[]): { deliverables: number; decisions: number; milestones: number; sessions: number }`
- `topicCounts(events: LedgerEvent[], depts: {k:string;name:string}[]): Array<{ deptK: string; name: string; count: number }>` (desc by count, zero dropped)

- [ ] **Step 1: Failing test** — `lib/overview/secondBrainStats.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ledgerCounts, topicCounts } from './secondBrainStats';
import type { LedgerEvent } from '@/lib/firebase/schema';

const ev = (type: LedgerEvent['type'], deptK?: string): LedgerEvent => ({
  ts: 1,
  type,
  actor: 'byte',
  deptK,
  title: type,
  summary: type,
});
const events: LedgerEvent[] = [
  ev('deliverable_approved', 'eng'),
  ev('deliverable_approved', 'eng'),
  ev('decision_made'),
  ev('stage_advanced'),
  ev('task_run', 'mkt'),
];
const depts = [
  { k: 'eng', name: 'Engineering' },
  { k: 'mkt', name: 'Marketing' },
  { k: 'ops', name: 'Ops' },
];

describe('ledgerCounts', () => {
  it('counts by category', () => {
    expect(ledgerCounts(events)).toEqual({
      deliverables: 2,
      decisions: 1,
      milestones: 1,
      sessions: 0,
    });
  });
});
describe('topicCounts', () => {
  it('counts events per dept, desc, dropping zero', () => {
    const t = topicCounts(events, depts);
    expect(t).toEqual([
      { deptK: 'eng', name: 'Engineering', count: 2 },
      { deptK: 'mkt', name: 'Marketing', count: 1 },
    ]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`Cannot find module './secondBrainStats'`)

- [ ] **Step 3: Implement** — `lib/overview/secondBrainStats.ts`:

```ts
import type { LedgerEvent } from '@/lib/firebase/schema';

export function ledgerCounts(events: LedgerEvent[]) {
  let deliverables = 0,
    decisions = 0,
    milestones = 0,
    sessions = 0;
  for (const e of events) {
    if (e.type === 'deliverable_approved') deliverables++;
    else if (e.type === 'decision_made' || e.type === 'fact_remembered') decisions++;
    else if (e.type === 'stage_advanced') milestones++;
    else if (e.type === 'build_session') sessions++;
  }
  return { deliverables, decisions, milestones, sessions };
}

export function topicCounts(
  events: LedgerEvent[],
  depts: { k: string; name: string }[],
): Array<{ deptK: string; name: string; count: number }> {
  const byK = new Map<string, number>();
  for (const e of events) if (e.deptK) byK.set(e.deptK, (byK.get(e.deptK) ?? 0) + 1);
  return depts
    .map((d) => ({ deptK: d.k, name: d.name, count: byK.get(d.k) ?? 0 }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count);
}
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit** — `git commit -m "feat(second-brain): pure ledger/topic stat helpers + tests"`

### Task 2: SecondBrainPanel component

**Files:** Create `components/views/overview/SecondBrainPanel.tsx`; Modify `components/views/OverviewView.tsx` (mount it right-side when `SECOND_BRAIN_V2`)

**Interfaces:** `SecondBrainPanel` props: `{ events, nextStep, tracking, companionId, onTopic(deptK) }`.

- [ ] **Step 1: Build the panel** — sections STATUS (ledgerCounts), BRAIN (model + companion name via `companionName(companionId)` from `@/lib/companions` if available, else the id), DO THIS NEXT (`nextStep?.taskTitle` + dept; empty → "You're all caught up"), USAGE (`tracking.sessions/commits/prs/linesChanged/hoursSaved`, omit zero rows), TOPICS (`topicCounts`, each a button calling `onTopic(deptK)`). Style to match the app's dark panels (reuse the Timeline panel's styling idiom).

- [ ] **Step 2: Mount in OverviewView** — when `SECOND_BRAIN_V2`, render `<SecondBrainPanel …/>` as a right-side absolutely-positioned rail (top:58,right:26,bottom:26,width:300), passing store values already destructured (`events`, `nextStep`, `tracking`, `companionId`). `onTopic={(k) => flyTo('dept:'+k)}`. (Add `tracking` to the store destructure in this file if not present.)

- [ ] **Step 3: Verify** — `npx tsc --noEmit` clean; `npx eslint …` 0 errors; `npm test` pass; dev smoke with flag on compiles.
- [ ] **Step 4: Commit** — `git commit -m "feat(second-brain): right info rail (status/brain/next/usage/topics)"`

---

## Phase 2 · 3-column layout

### Task 3: Copilot inline mode

**Files:** Modify `components/Copilot.tsx` (add `inline?: boolean`), `app/globals.css` (`.copilot.inline` overrides)

- [ ] **Step 1:** Add `inline` param to `Copilot({ inline }: { inline?: boolean })`; root becomes `<aside className={`copilot${inline ? ' inline' : ''}`}>`.
- [ ] **Step 2:** In `globals.css`, add `.copilot.inline { position: static; inset: auto; width: 100%; height: 100%; transform: none; box-shadow: none; }` (override the fixed/overlay rules; match actual property names in the existing `.copilot` rule — read it first).
- [ ] **Step 3:** Verify Copilot still renders normally (flag off path untouched — default `inline` false). tsc + lint + test.
- [ ] **Step 4: Commit** — `git commit -m "feat(chat): Copilot inline mode for embedding in a column"`

### Task 4: 3-column grid in OverviewView

**Files:** Modify `components/views/OverviewView.tsx`

- [ ] **Step 1:** When `SECOND_BRAIN_V2`, wrap the section in a CSS grid `grid-template-columns: 320px 1fr 300px` (rows full height): col1 `<Copilot inline />`, col2 the existing graph container + overlays, col3 `<SecondBrainPanel/>` (move it from the absolute overlay into the grid column). Flag off → existing single-pane markup unchanged.
- [ ] **Step 2:** Responsive: under ~1100px, hide the right rail; under ~820px, hide the left rail (media query or a width check from the existing `dims`), so the galaxy always has room.
- [ ] **Step 3:** Verify tsc + lint + test + dev smoke (flag on): three columns visible, chat left works, galaxy centered, rail right.
- [ ] **Step 4: Commit** — `git commit -m "feat(second-brain): 3-column Chitti layout (chat | galaxy | info)"`

---

## Phase 3 · Galaxy density + labels

### Task 5: references edges + high-weight labels

**Files:** Modify `lib/overview/knowledgeGraph.ts`, `lib/overview/knowledgeGraph.test.ts`, `components/views/OverviewView.tsx`

- [ ] **Step 1: Extend test** — assert `references` edges connect only same-dept knowledge nodes and are capped (e.g. ≤ 2 per node); assert `label === true` on the top-N by weight per kind.
- [ ] **Step 2: Implement** in `knowledgeGraph.ts`: after building knowledge nodes, for each dept group of knowledge nodes, add up to `CAP` (=2) `references` edges chaining them (node[i] → node[i+1]); set `label: true` on the top-N (=6) nodes by weight. Add `label?: boolean` to `KGNode` and `references` already in `KGEdgeKind`.
- [ ] **Step 3: View** — in the v2 node map, carry `label` onto the GNode; in `nodeThreeObject`, for a knowledge node with `label`, return a small SpriteText (like the dept label, smaller) instead of `undefined`; others stay hover-only. Map `references` edges to a faint link color.
- [ ] **Step 4: Verify** — tests pass, tsc + lint clean, dev smoke: denser web + labels on major nodes.
- [ ] **Step 5: Commit** — `git commit -m "feat(second-brain): denser galaxy — references cross-links + high-weight labels"`

---

## Final verification

- [ ] `npm test` pass, `npx tsc --noEmit` clean, `npm run lint` 0 errors.
- [ ] Manual (flag on): 3-column Second Brain — chat left, denser labeled galaxy center, real-data info rail right; no voice/capture UI. Flag off: Overview unchanged.

## Self-review

- Spec A (layout) → Tasks 4. B (chat) → Task 3. C (right rail) → Tasks 1–2. D (galaxy) → Task 5. E (omissions) honored (no voice/capture; USAGE uses real TrackingSummary fields, not calls/tokens).
- Phases independently mergeable; all flag-gated; renderer unchanged.
