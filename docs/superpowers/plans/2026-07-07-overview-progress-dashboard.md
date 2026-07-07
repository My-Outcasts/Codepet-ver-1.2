# Overview progress dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Overview show progress at a glance — an overall "how far along" hero (top-left) and a per-department progress ring + count on the map nodes.

**Architecture:** A pure `lib/overview/progress.ts` (`deptProgress`, `overviewProgress`) is the single source of the numbers. A presentational `OverviewProgressHud` renders the overall rollup; `OverviewView` computes it and draws a billboarded ring sprite + count onto each department node via the existing `nodeThreeObject`. Surfaces data already computed today; no scaffold/graph/persistence change.

**Tech Stack:** Next.js 16 / React 19, TypeScript, `react-force-graph-3d` + `three` + `three-spritetext`, node-env Vitest (no React Testing Library).

## Global Constraints

- **One source of truth for the numbers:** `deptProgress()` is used by BOTH the node build (per-department ring) AND `overviewProgress()` (hero), so the ring and hero can never disagree.
- **Overall universe = active plan:** `overviewProgress` counts only **non-dormant** departments (`!d.later`) — the same universe `currentStageProgress`/`stageComplete` use. Guard the 100%-iff-complete invariant (`done === total ? 100 : Math.min(99, round(...))`).
- **Hero content:** "BUILDING YOUR COMPANY" + fill bar + "{pct}% · {done}/{total} moves · {areasDone} of {areasTotal} areas done" + "Next: {nextStage} →" (from `nextStageOf(brief.stage)`); if no next stage → "Final stage" (no dead arrow). Live via the existing `tick` read (like `StageRibbon`). Wrapper `pointer-events: none`; no click target.
- **Ring:** a billboarded `THREE.Sprite` with a `CanvasTexture` arc (track + fill to `pct`), returned from `nodeThreeObject` in a `THREE.Group` with the label. Arc color = department identity color while in progress, **green `#34D399`** at 100%. NO per-frame screen projection. Preserve `nodeThreeObjectExtend` (the default sphere must still render).
- **Count:** appended to the department label — `"{name}  {done}/{total}"`, or `"{name} ✓"` at 100% — always visible (not just hover).
- **Untouched:** breadcrumb (`StageRibbon`), beacon (`ByteGuide`), first-run briefing, legend, example-plan banner, node colors/sizes/status encoding, the scaffold, persistence. No recede/unlock/momentum (pieces 2–4).
- Run `npm run format:check` before pushing (CI runs `prettier --check .` repo-wide).

---

## File Structure

- **Create** `lib/overview/progress.ts` — `deptProgress`, `overviewProgress` (+ types).
- **Create** `lib/overview/progress.test.ts` — node-env unit tests.
- **Create** `components/views/overview/OverviewProgressHud.tsx` — presentational hero.
- **Modify** `components/views/OverviewView.tsx` — render the HUD; add `done/total/pct` to department `GNode`s; extend `nodeThreeObject` with the ring + count.

---

## Task 1: Pure progress helpers

**Files:**

- Create: `lib/overview/progress.ts`
- Test: `lib/overview/progress.test.ts`

**Interfaces:**

- Consumes: `Dept` from `lib/data.ts` (`{ tasks: Task[]; later?: boolean; ... }`, `Task` has `done?: boolean`).
- Produces: `Progress`, `OverviewProgress`, `deptProgress(dept): Progress`, `overviewProgress(depts): OverviewProgress` — consumed by Tasks 2 & 3.

- [ ] **Step 1: Write the failing test**

Create `lib/overview/progress.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deptProgress, overviewProgress } from './progress';
import type { Dept } from '../data';

// Minimal Dept factory — only the fields the helpers read.
const dept = (dones: boolean[], later = false): Dept =>
  ({ tasks: dones.map((done) => ({ done })), later }) as unknown as Dept;

describe('deptProgress', () => {
  it('counts done/total and rounds pct', () => {
    expect(deptProgress(dept([true, true, false, false, false]))).toEqual({
      done: 2,
      total: 5,
      pct: 40,
    });
  });
  it('0 tasks → 0/0/0 (no divide-by-zero)', () => {
    expect(deptProgress(dept([]))).toEqual({ done: 0, total: 0, pct: 0 });
  });
  it('all done → 100', () => {
    expect(deptProgress(dept([true, true])).pct).toBe(100);
  });
});

describe('overviewProgress', () => {
  it('sums active departments; excludes dormant (later)', () => {
    const r = overviewProgress([
      dept([true, true, false]), // 2/3 active
      dept([true]), // 1/1 active (complete area)
      dept([false, false], true), // dormant — excluded
    ]);
    expect(r.done).toBe(3);
    expect(r.total).toBe(4);
    expect(r.areasTotal).toBe(2);
    expect(r.areasDone).toBe(1); // only the 1/1 department
  });
  it('never rounds to 100 while a task is open (100%-iff-complete)', () => {
    // 199/200 done across active depts must read 99, not 100.
    const big = { tasks: Array.from({ length: 200 }, (_, i) => ({ done: i < 199 })), later: false };
    expect(overviewProgress([big as unknown as Dept]).pct).toBe(99);
  });
  it('all complete → 100', () => {
    expect(overviewProgress([dept([true, true]), dept([true])]).pct).toBe(100);
  });
  it('empty department not counted as an area done', () => {
    const r = overviewProgress([dept([])]);
    expect(r).toEqual({ done: 0, total: 0, pct: 0, areasDone: 0, areasTotal: 1 });
  });
  it('no active departments → all zeros', () => {
    expect(overviewProgress([dept([true], true)])).toEqual({
      done: 0,
      total: 0,
      pct: 0,
      areasDone: 0,
      areasTotal: 0,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/overview/progress.test.ts`
Expected: FAIL — `Cannot find module './progress'`.

- [ ] **Step 3: Write the implementation**

Create `lib/overview/progress.ts`:

```ts
// Progress math for the Overview dashboard. Pure + node-env-Vitest-testable. The ONE
// source the per-department ring (node build) and the overall hero both read, so they
// can never disagree. Mirrors the non-dormant universe stages.ts uses.
import type { Dept } from '../data';

export interface Progress {
  done: number;
  total: number;
  pct: number;
}

// One department's task completion.
export function deptProgress(dept: Dept): Progress {
  const total = dept.tasks.length;
  const done = dept.tasks.filter((t) => t.done).length;
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}

export interface OverviewProgress extends Progress {
  /** Active (non-dormant) departments that are 100% complete. */
  areasDone: number;
  /** Total active (non-dormant) departments. */
  areasTotal: number;
}

// Whole active-plan rollup for the hero. Excludes dormant (`later`) departments.
export function overviewProgress(depts: Dept[]): OverviewProgress {
  let done = 0;
  let total = 0;
  let areasDone = 0;
  let areasTotal = 0;
  for (const d of depts) {
    if (d.later) continue;
    areasTotal += 1;
    const p = deptProgress(d);
    done += p.done;
    total += p.total;
    if (p.total > 0 && p.done === p.total) areasDone += 1;
  }
  // Guard: never read 100% with a task still open (matches currentStageProgress).
  const pct =
    total === 0 ? 0 : done === total ? 100 : Math.min(99, Math.round((done / total) * 100));
  return { done, total, pct, areasDone, areasTotal };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/overview/progress.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit` (only the pre-existing unrelated `firestore.rules.test.ts` errors) and `npx eslint lib/overview/progress.ts lib/overview/progress.test.ts` (clean).

- [ ] **Step 6: Commit**

```bash
git add lib/overview/progress.ts lib/overview/progress.test.ts
git commit -m "feat(overview): pure progress helpers (deptProgress, overviewProgress)"
```

---

## Task 2: Overall hero HUD

**Files:**

- Create: `components/views/overview/OverviewProgressHud.tsx`
- Modify: `components/views/OverviewView.tsx`

**Interfaces:**

- Consumes: `overviewProgress` (Task 1); `nextStageOf` (already imported in OverviewView); `brief`, `tick` from `useApp()` (both already destructured in OverviewView).
- Produces: the `OverviewProgressHud` component, rendered by `OverviewView`.

- [ ] **Step 1: Create `components/views/overview/OverviewProgressHud.tsx`**

```tsx
'use client';
// The Overview's overall progress hero — a small persistent HUD at the map's top-left
// (under the breadcrumb): how far along the whole active plan is, plus the next
// milestone. Presentational; OverviewView computes the numbers and keeps it live.
import type { OverviewProgress } from '@/lib/overview/progress';

const CYAN = '#7DE3FF';

export default function OverviewProgressHud({
  progress,
  nextStage,
}: {
  progress: OverviewProgress;
  nextStage: string | null;
}) {
  const { pct, done, total, areasDone, areasTotal } = progress;
  return (
    <div
      style={{
        position: 'absolute',
        top: 52,
        left: 16,
        zIndex: 5,
        width: 210,
        padding: '10px 12px',
        background: 'rgba(16,14,28,0.82)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: '1px solid rgba(125,227,255,0.22)',
        borderRadius: 11,
        pointerEvents: 'none',
        fontFamily: 'inherit',
      }}
    >
      <div
        style={{
          fontSize: 9,
          letterSpacing: '0.9px',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: CYAN,
        }}
      >
        Building your company
      </div>
      <div
        style={{
          marginTop: 7,
          height: 5,
          borderRadius: 3,
          background: 'rgba(255,255,255,0.12)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: CYAN,
            transition: 'width .4s ease',
          }}
        />
      </div>
      <div style={{ marginTop: 7, display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#F5F3FF' }}>{pct}%</span>
        <span style={{ fontSize: 10.5, color: 'rgba(245,243,255,0.6)' }}>
          {done}/{total} moves · {areasDone} of {areasTotal} areas
        </span>
      </div>
      <div style={{ marginTop: 4, fontSize: 10, color: 'rgba(245,243,255,0.45)' }}>
        {nextStage ? `Next: ${nextStage} →` : 'Final stage'}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Render it in `OverviewView.tsx`**

Add the import near the other overview-component imports (by `StageRibbon`):

```ts
import OverviewProgressHud from '@/components/views/overview/OverviewProgressHud';
import { overviewProgress } from '@/lib/overview/progress';
```

`brief` and `tick` are already destructured from `useApp()`, and `void tick;` already
forces re-render on company mutation. Compute the hero inputs in the component body (near
where `examplePlan` is computed, ~line 126). Because `overviewProgress` reads the mutable
`DEPTS` singleton, reference `tick` so it recomputes each bump:

```ts
void tick; // (already present) keeps the reads below live
const progress = overviewProgress(DEPTS);
const nextMilestone = nextStageOf(brief.stage);
```

Render the HUD right after `<StageRibbon />` (so it layers under the breadcrumb, over the
graph). It shows on the live map; the first-run intro modal covers it until dismissed
(unchanged — the intro is a higher z-index overlay):

```tsx
      <StageRibbon />
      <OverviewProgressHud progress={progress} nextStage={nextMilestone} />
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors (only the pre-existing `firestore.rules.test.ts` errors).

- [ ] **Step 4: Lint the changed files**

Run: `npx eslint components/views/overview/OverviewProgressHud.tsx components/views/OverviewView.tsx`
Expected: 0 errors. (Pre-existing OverviewView `exhaustive-deps` warnings on unrelated hooks may remain — do not introduce NEW ones.)

- [ ] **Step 5: Full unit suite**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add components/views/overview/OverviewProgressHud.tsx components/views/OverviewView.tsx
git commit -m "feat(overview): overall progress hero HUD"
```

---

## Task 3: Per-department ring + count on nodes

**Files:**

- Modify: `components/views/OverviewView.tsx`

**Interfaces:**

- Consumes: `deptProgress` (Task 1); `THREE`, `SpriteText` (already imported); the existing `GNode` type + department node build + `nodeThreeObject`.
- Produces: department nodes rendering a progress ring + count.

- [ ] **Step 1: Add `done/total/pct` to the `GNode` type**

In `interface GNode` (after `sub?: string;`), add:

```ts
  done?: number;
  total?: number;
  pct?: number;
```

- [ ] **Step 2: Populate them in the department node build**

In the `DEPTS.forEach(...)` node build, the department push already computes `done`/`total`
inline. Replace those with the shared helper and carry the fields onto the node. Add the
import near the other `lib/overview` / `lib/data` imports:

```ts
import { deptProgress } from '@/lib/overview/progress';
```

In the loop, compute once and reuse (replaces the existing `const done = …` / `const total = …`):

```ts
const dp = deptProgress(d);
const done = dp.done;
const total = dp.total;
```

Then add `done`, `total`, `pct` to the pushed department node object (alongside `sub`):

```ts
        sub: `${done}/${total} done · ${d.status === 'attention' ? 'needs you' : d.status}`,
        done,
        total,
        pct: dp.pct,
```

(The `allDone` computation and everything else in the push are unchanged.)

- [ ] **Step 3: Add a ring-sprite builder**

Add this helper near `nodeThreeObject` (module-scope function, above the component or just
above `nodeThreeObject`):

```ts
// A billboarded ring sprite: a faint full track + an arc filled clockwise from the top to
// `pct`. Drawn on a canvas → CanvasTexture → Sprite, so it always faces the camera (reads
// as a clean circle at any orbit angle) with no per-frame screen projection.
function makeRingSprite(pct: number, colorHex: string, size: number): THREE.Sprite {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const cx = S / 2;
  const cy = S / 2;
  const r = S * 0.4;
  const lw = S * 0.08;
  ctx.lineCap = 'round';
  // track
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = lw;
  ctx.stroke();
  // filled arc
  if (pct > 0) {
    const start = -Math.PI / 2;
    const end = start + (Math.min(100, pct) / 100) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, end);
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  sprite.scale.set(size, size, 1);
  return sprite;
}
```

- [ ] **Step 4: Extend `nodeThreeObject` for department nodes**

Replace the department branch of `nodeThreeObject` (currently: build a `SpriteText` and
return it) with: build the label (name + count), build the ring, return a `THREE.Group`
of both. Task/project nodes are unchanged.

```ts
const nodeThreeObject = (n: GNode): any => {
  if (n.kind === 'task') return undefined; // default sphere; label on hover

  // Label — for departments, append the progress count.
  const total = n.total ?? 0;
  const done = n.done ?? 0;
  const labelText =
    n.kind === 'dept' && total > 0
      ? done === total
        ? `${n.name} ✓`
        : `${n.name}  ${done}/${total}`
      : n.name;
  const s = new SpriteText(labelText);
  s.color = '#FFFFFF';
  s.textHeight = n.kind === 'project' ? 6 : 4;
  s.fontFace = 'Inter, system-ui, sans-serif';
  s.fontWeight = n.kind === 'project' ? '700' : '600';
  (s as any).backgroundColor = n.kind === 'project' ? 'rgba(7,5,16,0.85)' : 'rgba(7,5,16,0.7)';
  (s as any).padding = n.kind === 'project' ? 3 : 2;
  (s as any).borderRadius = 3;
  s.strokeColor = 'rgba(0,0,0,0.5)';
  s.strokeWidth = 0.5;
  const radius = Math.cbrt(n.val) * 2.2;
  (s as any).position.set(0, radius + (n.kind === 'project' ? 10 : 5), 0);

  // Project node: label only (overall progress lives in the hero HUD).
  if (n.kind !== 'dept') return s;

  // Department node: label + progress ring around the node.
  const ringColor = total > 0 && done === total ? '#34D399' : (n.deptColor ?? '#8B5CF6');
  const ring = makeRingSprite(n.pct ?? 0, ringColor, radius * 3.4); // tune multiplier on preview
  const group = new THREE.Group();
  group.add(ring);
  group.add(s);
  return group;
};
```

(`nodeThreeObjectExtend` stays on, so this Group is added alongside the default sphere; the
ring at the group origin encircles the sphere, the label sits above.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors (only the pre-existing `firestore.rules.test.ts` errors).

- [ ] **Step 6: Lint the changed file**

Run: `npx eslint components/views/OverviewView.tsx`
Expected: 0 errors; no NEW warnings (the file has pre-existing `exhaustive-deps` warnings on unrelated hooks — leave them).

- [ ] **Step 7: Full unit suite + format**

Run: `npx vitest run` (all pass), then `npm run format:check` (clean; if not, `npx prettier --write` the changed files and re-check).

- [ ] **Step 8: Commit**

```bash
git add components/views/OverviewView.tsx
git commit -m "feat(overview): per-department progress ring + count on map nodes"
```

---

## Self-Review Notes (author checklist — done)

- **Spec coverage:** overall hero (rollup + next milestone, live, top-left) → Task 2; per-department ring + count → Task 3; one source of truth → `deptProgress` used by both (Tasks 1→2/3); 100%-iff-complete guard → Task 1 + tested; edge cases (0 tasks, no active depts, final stage) → Task 1 tests + hero `nextStage` fallback.
- **Type consistency:** `Progress`/`OverviewProgress`/`deptProgress`/`overviewProgress` names identical across tasks; `GNode` gains `done/total/pct` (Task 3) matching what `nodeThreeObject` reads.
- **No placeholders:** every step has full code or exact edits with anchors.
- **Renderer correctness:** `nodeThreeObjectExtend` preserved (sphere stays); ring billboards (Sprite) so no screen-projection desync; canvas via `document` is safe (OverviewView is client/ssr:false).
- **Scope discipline:** no recede/unlock/momentum; no ring on the project node; colors/sizes/status/scaffold untouched.

```

```
