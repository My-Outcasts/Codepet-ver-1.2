# Unified Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Overview the single home that also narrates the journey — a slim 5-phase ribbon + a reactive map + the lifted stage drawer — and retire the Roadmap tab.

**Architecture:** Re-compose existing parts onto the Overview: a new pure `ribbonSegments()` helper drives a slim `StageRibbon` HUD; the `StageDrawer` is lifted out of `RoadmapView` into a shared Overview component; `OverviewView` gains a deeper done-work recede, a drawer-dim scrim, and a stage-complete Advance state on the Next-step card; the Roadmap route/nav/callers are retired. No new systems, no `nextStep`/scaffold/run-task changes.

**Tech Stack:** Next.js 16 / React 19 / TypeScript; vitest (node environment — no jsdom, so tests are pure logic); react-force-graph-3d (canvas, not unit-tested).

## Global Constraints

- **Design:** minimalist, space-forward; NO decorative emojis/icons/arrows; inline styles matching the existing glass HUD cards (`rgba(16,14,28,.72)`, `blur(10px)`, `1px` hairline border) — do not add global CSS.
- **Reuse, don't invent:** drive everything from existing helpers (`PHASES`, `eff`, `stageWatermark`, `stageComplete`, `nextStageOf`, `advanceStage`, `selectStage`, `currentStageProgress`) and the existing `nextStep` beacon spine. No new AI, no scaffold/run-task/next-step changes.
- **Honest map:** the map reflects only real live tasks for the current stage — never fabricate nodes for past/future stages. Clicking a non-current phase opens its authored checklist in the drawer and dims the map; it does not repopulate the graph.
- **Exactly one `current`:** `ribbonSegments()` must yield exactly one `current` segment whenever the watermark sits within the phase range.
- **Tests are node-env pure:** no `@testing-library`/jsdom is installed; components are verified by `tsc` + `eslint` + Vercel preview, logic by vitest. Snapshot/restore the shared `DEPTS` singleton (see `lib/stages.test.ts`) and reset the watermark via `setStageWatermark` around each case.
- **Do NOT touch Giang's Build Coach:** `BuildCoachView`/`InstallView`/`SummaryView` build-coach internals, toolkit/hooks, `/api/track*`, `/api/build-plan`. (Rerouting `SummaryView`'s one `show('roadmap')` click handler is in bounds — it is app navigation, not Build Coach logic.)
- **Gate before every commit** from the worktree root: `./node_modules/.bin/tsc --noEmit` (0 errors), `./node_modules/.bin/eslint .` (exit 0), `./node_modules/.bin/prettier --check <changed files>`, `./node_modules/.bin/vitest run` (all green). The node_modules symlink runs checks but breaks `next dev`; verify UI on the Vercel preview.
- **Worktree:** `/private/tmp/claude-501/-Users-monatruong/d31cb161-d475-4451-86b0-aea1ff23a43b/scratchpad/wt-overview`, branch `feat/unified-overview` off `origin/main`.

---

### Task 1: Pure ribbon + current-stage progress helpers

**Files:**

- Create: `lib/overview/ribbon.ts`
- Modify: `lib/stages.ts` (add `currentStageProgress` after `companyProgress`, ~line 103)
- Test: `lib/overview/ribbon.test.ts`
- Test: `lib/stages.test.ts` (append a `currentStageProgress` describe block)

**Interfaces:**

- Consumes: `PHASES` (`{ name: string; stages: { n: number; name: string }[] }[]`) and `eff(n): 'done'|'locked'|'now'|'next'` from `@/lib/roadmap`; `setStageWatermark(n)` / `stageWatermark()` from `@/lib/roadmap`; `DEPTS`, `GroupProgress` from `@/lib/stages`.
- Produces:
  - `ribbonSegments(): RibbonSegment[]` where `interface RibbonSegment { name: string; state: 'done'|'current'|'future'; stageN: number }` — one entry per phase, in `PHASES` order.
  - `currentStageProgress(): GroupProgress` (`{ done: number; total: number; pct: number }`) — fraction of active (non-`later`) dept tasks done; `pct === 100` iff `stageComplete()` (when total > 0).

- [ ] **Step 1: Write the failing test for `ribbonSegments`**

Create `lib/overview/ribbon.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { PHASES } from '../data';
import { setStageWatermark, stageWatermark } from '../roadmap';
import { ribbonSegments } from './ribbon';

describe('ribbonSegments', () => {
  const restore = stageWatermark();
  afterEach(() => setStageWatermark(restore));

  it('returns one segment per phase, in order', () => {
    const segs = ribbonSegments();
    expect(segs.map((s) => s.name)).toEqual(PHASES.map((p) => p.name));
  });

  it('marks exactly one phase current for a mid-journey watermark (stage 6)', () => {
    setStageWatermark(6);
    const segs = ribbonSegments();
    expect(segs.filter((s) => s.state === 'current')).toHaveLength(1);
    const cur = segs.find((s) => s.state === 'current')!;
    expect(cur.stageN).toBe(6); // opens the "now" stage
  });

  it('phases fully before the watermark are done, fully after are future', () => {
    setStageWatermark(6);
    const segs = ribbonSegments();
    expect(segs[0].state).toBe('done'); // Find (stage 1) is behind us
    expect(segs[0].stageN).toBe(1); // a non-current segment opens its first stage
    expect(segs[segs.length - 1].state).toBe('future');
  });

  it('everything is done when the watermark is past the last stage', () => {
    setStageWatermark(999);
    const segs = ribbonSegments();
    expect(segs.every((s) => s.state === 'done')).toBe(true);
    expect(segs.some((s) => s.state === 'current')).toBe(false);
  });

  it('first phase is current at the very start (watermark 1)', () => {
    setStageWatermark(1);
    const segs = ribbonSegments();
    expect(segs[0].state).toBe('current');
    expect(segs.slice(1).every((s) => s.state === 'future')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run lib/overview/ribbon.test.ts`
Expected: FAIL — `Failed to resolve import "./ribbon"` (module doesn't exist yet).

- [ ] **Step 3: Implement `lib/overview/ribbon.ts`**

```ts
// Pure derivation for the Overview's stage ribbon: the 5 PHASES as segments,
// each read as done / current / future purely by position vs the stage
// watermark (same source the retired Roadmap used, so they can't disagree).
// Exactly one segment is ever `current` — the phase holding the watermark.
import { PHASES } from '../data';
import { eff } from '../roadmap';

export type PhaseState = 'done' | 'current' | 'future';

export interface RibbonSegment {
  /** Phase name (e.g. "Build"). */
  name: string;
  /** Position of this phase relative to where the founder is now. */
  state: PhaseState;
  /** Stage number to open when the segment is clicked: the phase's "now"
   *  stage if it's current, otherwise the phase's first stage. */
  stageN: number;
}

export function ribbonSegments(): RibbonSegment[] {
  return PHASES.map((p) => {
    // eff() only reads `.n`; a phase's stage carries it, so pass it directly.
    const states = p.stages.map((s) => eff(s));
    const state: PhaseState = states.includes('now')
      ? 'current'
      : states.every((x) => x === 'done')
        ? 'done'
        : 'future';
    const nowStage = p.stages.find((s) => eff(s) === 'now');
    const stageN = state === 'current' && nowStage ? nowStage.n : p.stages[0].n;
    return { name: p.name, state, stageN };
  });
}
```

- [ ] **Step 4: Run the ribbon test to verify it passes**

Run: `./node_modules/.bin/vitest run lib/overview/ribbon.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing test for `currentStageProgress`**

Append to `lib/stages.test.ts` (add `currentStageProgress` to the existing import from `./stages`):

```ts
describe('currentStageProgress', () => {
  const snap = DEPTS.map((d) => ({ tasks: d.tasks, later: d.later }));
  const task = (done: boolean): Task => ({ t: 'x', done }) as Task;
  afterEach(() => {
    DEPTS.forEach((d, i) => {
      d.tasks = snap[i].tasks;
      d.later = snap[i].later;
    });
  });

  it('is the done-fraction of active (non-later) tasks', () => {
    DEPTS.forEach((d) => {
      d.later = false;
      d.tasks = [task(true), task(false)];
    });
    const p = currentStageProgress();
    expect(p.pct).toBe(50);
  });

  it('excludes dormant "later" departments', () => {
    DEPTS.forEach((d, i) => {
      d.later = i > 0; // only the first dept is active
      d.tasks = i === 0 ? [task(true), task(true)] : [task(false)];
    });
    expect(currentStageProgress()).toMatchObject({ done: 2, total: 2, pct: 100 });
  });

  it('is 0% (not NaN) with no active tasks', () => {
    DEPTS.forEach((d) => {
      d.later = true;
      d.tasks = [];
    });
    expect(currentStageProgress().pct).toBe(0);
  });
});
```

Note: `lib/stages.test.ts` already imports `{ DEPTS, type Task }` and `{ describe, it, expect, afterEach }`. Add `currentStageProgress` to the `./stages` import.

- [ ] **Step 6: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run lib/stages.test.ts`
Expected: FAIL — `currentStageProgress is not a function` / not exported.

- [ ] **Step 7: Implement `currentStageProgress` in `lib/stages.ts`**

Add after `companyProgress` (end of file, ~line 103):

```ts
/**
 * How far through the current stage: the done-fraction of active (non-`later`)
 * department tasks — the same universe `stageComplete()` measures, so `pct === 100`
 * iff `stageComplete()` (when there is at least one active task). Reads the live
 * DEPTS singleton — call per render.
 */
export function currentStageProgress(): GroupProgress {
  let done = 0;
  let total = 0;
  for (const d of DEPTS) {
    if (d.later) continue;
    for (const t of d.tasks) {
      total += 1;
      if (t.done) done += 1;
    }
  }
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}
```

- [ ] **Step 8: Run the full suite to verify green**

Run: `./node_modules/.bin/vitest run lib/overview/ribbon.test.ts lib/stages.test.ts`
Expected: PASS (all cases).

- [ ] **Step 9: Gate + commit**

```bash
./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint . && ./node_modules/.bin/prettier --write lib/overview/ribbon.ts lib/overview/ribbon.test.ts lib/stages.ts lib/stages.test.ts
git add lib/overview/ribbon.ts lib/overview/ribbon.test.ts lib/stages.ts lib/stages.test.ts
git commit -m "feat: pure ribbon + current-stage progress helpers for unified Overview"
```

---

### Task 2: StageRibbon component

**Files:**

- Create: `components/views/overview/StageRibbon.tsx`

**Interfaces:**

- Consumes: `ribbonSegments()` + `RibbonSegment` from `@/lib/overview/ribbon`; `currentStageProgress()` from `@/lib/stages`; `stageComplete`, `nextStageOf` from `@/lib/stages`; `useApp()` for `{ selectStage, advanceStage, brief, tick }`.
- Produces: `export default function StageRibbon()` — a slim fixed top HUD bar. No props.

Not unit-testable (DOM/visual; no jsdom). Verified by `tsc` + `eslint` + Vercel preview.

- [ ] **Step 1: Implement `components/views/overview/StageRibbon.tsx`**

```tsx
'use client';
// The stage ribbon — the retired Roadmap, compacted onto the map. Five phases
// left→right; the phase you're in is lit with a fill for how far through the
// current stage you are; done phases are filled, future ones faint. Click a
// phase to open its checklist (StageDrawer). When the stage's work is finished,
// the current phase offers to advance. Display sits in the glass-HUD style.
import { useApp } from '@/lib/store';
import { ribbonSegments, type RibbonSegment } from '@/lib/overview/ribbon';
import { currentStageProgress, stageComplete, nextStageOf } from '@/lib/stages';

const CARD_BG = 'rgba(16,14,28,0.72)';
const BORDER = 'rgba(255,255,255,0.09)';

export default function StageRibbon() {
  const { selectStage, advanceStage, brief, tick } = useApp();
  void tick; // re-render on company mutation (progress + watermark are live reads)
  const segs = ribbonSegments();
  const pct = currentStageProgress().pct;
  const complete = stageComplete();
  const nextStage = nextStageOf(brief.stage);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 6,
        display: 'flex',
        gap: 6,
        padding: '10px 16px',
        background: 'linear-gradient(180deg, rgba(7,5,16,0.82) 0%, rgba(7,5,16,0) 100%)',
        pointerEvents: 'none',
      }}
    >
      {segs.map((s) => (
        <Segment
          key={s.name}
          seg={s}
          pct={pct}
          complete={complete && s.state === 'current'}
          nextStage={nextStage}
          onOpen={() => selectStage(s.stageN)}
          onAdvance={advanceStage}
        />
      ))}
    </div>
  );
}

function Segment({
  seg,
  pct,
  complete,
  nextStage,
  onOpen,
  onAdvance,
}: {
  seg: RibbonSegment;
  pct: number;
  complete: boolean;
  nextStage: string | null;
  onOpen: () => void;
  onAdvance: () => void;
}) {
  const current = seg.state === 'current';
  const done = seg.state === 'done';
  const fill = current ? pct : done ? 100 : 0;
  const tint = done ? '#34D399' : current ? '#8B5CF6' : 'rgba(255,255,255,0.14)';
  const label = complete && nextStage ? `Advance to ${nextStage}` : seg.name;
  return (
    <button
      onClick={complete ? onAdvance : onOpen}
      title={current ? `You are here · ${pct}% through this stage` : seg.name}
      style={{
        flex: 1,
        pointerEvents: 'auto',
        position: 'relative',
        overflow: 'hidden',
        textAlign: 'left',
        fontFamily: 'inherit',
        cursor: 'pointer',
        border: `1px solid ${current ? 'rgba(139,92,246,0.5)' : BORDER}`,
        borderRadius: 9,
        background: CARD_BG,
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        padding: '7px 11px',
        color: current ? '#F5F3FF' : done ? 'rgba(245,243,255,.72)' : 'rgba(245,243,255,.4)',
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          height: 2,
          width: `${fill}%`,
          background: tint,
          transition: 'width .3s ease',
        }}
      />
      <span
        style={{
          fontSize: 9,
          letterSpacing: '1px',
          fontWeight: 700,
          textTransform: 'uppercase',
          opacity: current ? 0.55 : 0.4,
        }}
      >
        {current ? 'You are here' : done ? 'Done' : 'Ahead'}
      </span>
      <span
        style={{
          display: 'block',
          fontSize: 12.5,
          fontWeight: 600,
          letterSpacing: '-.2px',
          marginTop: 2,
        }}
      >
        {label}
      </span>
    </button>
  );
}
```

- [ ] **Step 2: Verify it compiles and lints**

Run: `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint components/views/overview/StageRibbon.tsx`
Expected: 0 errors, exit 0.

- [ ] **Step 3: Gate + commit**

```bash
./node_modules/.bin/prettier --write components/views/overview/StageRibbon.tsx
git add components/views/overview/StageRibbon.tsx
git commit -m "feat: StageRibbon component (5-phase HUD with progress fill + advance)"
```

---

### Task 3: Lift StageDrawer into a shared Overview component

**Files:**

- Create: `components/views/overview/StageDrawer.tsx`
- Modify: `components/views/RoadmapView.tsx` (delete its local `Lock` + `StageDrawer`; import them from the new module)

**Interfaces:**

- Produces: `export function StageDrawer()` and `export const Lock` from `components/views/overview/StageDrawer.tsx`.
- Consumes (unchanged, inside the moved code): `useApp()`, `byN`, `DEPTS` from `@/lib/data`, `eff`, `nextAction` from `@/lib/roadmap`, `stageComplete`, `nextStageOf` from `@/lib/stages`.

This is a move, not a rewrite — the drawer's behavior and markup are unchanged, so the app keeps building. `RoadmapView.tsx` still exists (deleted in Task 5) and now imports the shared drawer + `Lock`.

- [ ] **Step 1: Create `components/views/overview/StageDrawer.tsx`**

Move the `Lock` component (currently `RoadmapView.tsx:8-13`) and the `StageDrawer` function (currently `RoadmapView.tsx:15-127`) verbatim into a new file, adding `'use client'` and the imports they rely on. Full file:

```tsx
'use client';
// The stage detail drawer — lifted out of the retired RoadmapView so the
// Overview can open it when a ribbon phase is clicked. Behavior unchanged:
// the stage's why, its authored checklist, and byte's next move / advance-stage.
import { useApp } from '@/lib/store';
import { byN, DEPTS } from '@/lib/data';
import { eff, nextAction } from '@/lib/roadmap';
import { stageComplete, nextStageOf } from '@/lib/stages';

export const Lock = () => (
  <svg className="lockic" viewBox="0 0 16 16" fill="none">
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
    <path d="M5.5 7V5.2a2.5 2.5 0 015 0V7" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

export function StageDrawer() {
  const { selStage, drawerOpen, closeStage, nextStep, portalToTask, advanceStage, brief } =
    useApp();
  const n = byN(selStage);
  if (!n) return null;
  const e = eff(n);
  const readyToAdvance = e === 'now' && stageComplete();
  const nextStage = nextStageOf(brief.stage);

  const here = (() => {
    if (nextStep) {
      const d = DEPTS.find((x) => x.k === nextStep.deptK);
      const t = d?.tasks.find((x) => x.t === nextStep.taskTitle && !x.done);
      if (d && t) return { d, t };
    }
    const fb = nextAction();
    return fb ? { d: fb.dept, t: fb.task } : null;
  })();
  const sLbl =
    e === 'done' ? 'Complete' : e === 'now' ? 'In progress' : e === 'next' ? 'Up next' : 'Locked';
  const sCls =
    e === 'done' ? 'st-done' : e === 'now' ? 'st-draft' : e === 'next' ? 'st-you' : 'st-locked';
  const CHK = (
    <svg viewBox="0 0 16 16" width="10" height="10" fill="none">
      <path
        d="M3 8l3.5 3.5L13 4"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  const Checklist = () => (
    <div className="jd-acts">
      {n.a.map((it: any, i: number) => {
        const t = typeof it === 'string' ? it : it.t;
        const o = typeof it === 'object' ? it.o : '';
        return (
          <div className={`jd-a ${e === 'done' ? 'done' : ''}`} key={i}>
            <span className="b">{e === 'done' ? CHK : ''}</span>
            <div className="jd-a-tx">
              <div className="jd-a-t">{t}</div>
              {o && <div className="jd-a-o">{o}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );

  const cta: React.ReactNode =
    e === 'next' ? (
      <span className="lock">
        <Lock /> Up next — you&apos;ll get here as you progress. Start one early from its department
        any time.
      </span>
    ) : null;

  const nextMove =
    readyToAdvance && nextStage ? (
      <div className="jd-next">
        <div className="jd-next-lbl">Stage complete</div>
        <div className="jd-next-t">You&apos;ve finished this stage&apos;s work.</div>
        <div className="jd-next-s">Ready to move to {nextStage}?</div>
        <button className="jd-next-go" onClick={advanceStage}>
          Advance to {nextStage}
        </button>
      </div>
    ) : e === 'now' && here ? (
      <div className="jd-next">
        <div className="jd-next-lbl">byte&apos;s next move</div>
        <div className="jd-next-t">{here.t.t}</div>
        <div className="jd-next-s">{here.d.name}</div>
        <button className="jd-next-go" onClick={() => portalToTask(here.d.k, here.t.t)}>
          Start
        </button>
      </div>
    ) : null;

  const body = (
    <>
      {nextMove}
      <div className="jdr-lbl">Checklist</div>
      <Checklist />
    </>
  );

  return (
    <aside className={`jdrawer${drawerOpen ? ' open' : ''}`}>
      <div className="jdr-head">
        <span className="jd-ph">{n.ph}</span>
        <span className={`tstate ${sCls}`}>
          <i />
          {sLbl}
        </span>
        <button className="jdr-x" onClick={closeStage}>
          ✕
        </button>
      </div>
      <div className="jdr-title">{n.name}</div>
      <div className="jd-why">{n.why}</div>
      {body}
      {cta && <div className="jd-cta">{cta}</div>}
    </aside>
  );
}
```

- [ ] **Step 2: Update `RoadmapView.tsx` to import the lifted pieces**

In `components/views/RoadmapView.tsx`: delete the local `Lock` const (lines 8-13) and the entire local `StageDrawer` function (lines 15-127). Add an import so `RoadmapView`'s stage cards still get `Lock` and the view still renders `<StageDrawer />`:

Replace the top imports block:

```tsx
'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/store';
import { PHASES, NODES, byN, DEPTS } from '@/lib/data';
import { eff, nextAction } from '@/lib/roadmap';
import { stageComplete, nextStageOf } from '@/lib/stages';
```

with:

```tsx
'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/store';
import { PHASES, NODES, byN } from '@/lib/data';
import { eff } from '@/lib/roadmap';
import { StageDrawer, Lock } from './overview/StageDrawer';
```

(`DEPTS`, `nextAction`, `stageComplete`, `nextStageOf` were only used by the moved `StageDrawer`; dropping them keeps eslint's no-unused clean. `RoadmapView` itself still uses `PHASES`, `NODES`, `byN`, `eff`, and now-imported `Lock` + `<StageDrawer />`.)

- [ ] **Step 3: Verify it compiles, lints, and the suite is green**

Run: `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint . && ./node_modules/.bin/vitest run`
Expected: 0 tsc errors, eslint exit 0, all tests pass (behavior unchanged; nothing imports the drawer differently yet).

- [ ] **Step 4: Gate + commit**

```bash
./node_modules/.bin/prettier --write components/views/overview/StageDrawer.tsx components/views/RoadmapView.tsx
git add components/views/overview/StageDrawer.tsx components/views/RoadmapView.tsx
git commit -m "refactor: lift StageDrawer + Lock into shared Overview component"
```

---

### Task 4: Wire ribbon + drawer + reactive map + advance into OverviewView

**Files:**

- Modify: `components/views/OverviewView.tsx`

**Interfaces:**

- Consumes: `StageRibbon` (default) from `@/components/views/overview/StageRibbon`; `StageDrawer` from `@/components/views/overview/StageDrawer`; `stageComplete`, `nextStageOf` from `@/lib/stages`; `advanceStage`, `selStage`, `drawerOpen` added to the `useApp()` destructure.
- Produces: the finished unified Overview (no new exports).

Not unit-testable (3D canvas). Verified by `tsc` + `eslint` + Vercel preview.

- [ ] **Step 1: Swap imports — drop the dead progress helpers, add the new pieces**

In `components/views/OverviewView.tsx`, replace the stages import (lines 22-29) and add the two component imports right after the `taskState` import (line 21):

Replace:

```tsx
import { nextAction, stageWatermark } from '@/lib/roadmap';
import {
  stageIndexOf,
  stageLabelOf,
  currentPhaseName,
  productProgress,
  companyProgress,
} from '@/lib/stages';
```

with:

```tsx
import { nextAction, stageWatermark } from '@/lib/roadmap';
import { stageComplete, nextStageOf } from '@/lib/stages';
import StageRibbon from '@/components/views/overview/StageRibbon';
import { StageDrawer } from '@/components/views/overview/StageDrawer';
```

- [ ] **Step 2: Extend the `useApp()` destructure**

Replace the destructure (lines 89-99) — add `advanceStage`, `selStage`, `drawerOpen`, and `brief` is already present:

```tsx
const {
  openDept,
  runTask,
  briefDepartment,
  tick,
  brief,
  nextStep,
  show,
  selectStage,
  portalSignal,
  advanceStage,
  selStage,
  drawerOpen,
} = useApp();
```

(Keep `show` and `selectStage` in this list for now — they are still referenced by the ProgressCard usage block until Step 6 removes it, at which point both become unused and are deleted from the destructure. `brief` and `nextStep` are already present.)

- [ ] **Step 3: Deepen the done-work recede in the graph data**

In the `useMemo` that builds nodes: for departments, dim a fully-done department; for tasks, sink done tasks further back.

Replace the department node push's `val`/`color` (lines 149-161) — compute an `allDone` flag and use it:

```tsx
const allDone = total > 0 && done === total;
nodes.push({
  id: did,
  name: d.name,
  kind: 'dept',
  deptColor: dHex,
  color: rgba(dHex, allDone ? 0.32 : alpha),
  val: allDone ? 4 : d.status === 'attention' ? 7 : 5,
  dept: d,
  sub: `${done}/${total} done · ${d.status === 'attention' ? 'needs you' : d.status}`,
  x: dx,
  y: dy,
  z: dz,
});
```

Replace the task node push's `color`/`val` (lines 177-182):

```tsx
        nodes.push({
          id: tid,
          name: t.t,
          kind: 'task',
          color: rgba(tHex, t.done ? 0.28 : 0.95),
          val: t.done ? 0.7 : 1.1,
          dept: d,
          task: t,
          sub: `${d.name} · ${st.label}`,
```

(Done work recedes — lower alpha, smaller node — so the live current-stage work reads as "what's alive". The beacon still overrides color/size for the one next task via `beaconId`.)

- [ ] **Step 4: Add the drawer-dim scrim + render the ribbon and drawer**

Compute a dim flag near the other `useMemo`s (e.g. right after `beaconHex`, ~line 232):

```tsx
// When the founder opens a stage that isn't where they are now, the map has no
// real nodes to show for it (tasks are scaffolded for the current stage only),
// so we dim the live map to background and let the drawer carry that stage's
// authored checklist. Opening the current stage keeps the map fully lit.
const mapDimmed = drawerOpen && selStage !== stageWatermark();
```

In the returned JSX: add `<StageRibbon />` as the first child of the `<section>` (before the title block, ~line 383), render `<StageDrawer />` just before the closing `</section>` (~line 512), and add the scrim inside the `wrapRef` div. Concretely:

Right after `<section ...>` opening tag, insert:

```tsx
<StageRibbon />
```

Replace the graph wrapper `<div ref={wrapRef} ...>` opening (line 443) through its children so the scrim overlays the canvas — add the scrim as a sibling after the `ForceGraph3D` block, still inside `wrapRef`:

```tsx
      <div ref={wrapRef} style={{ position: 'absolute', inset: 0 }}>
        {mapDimmed && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 4,
              background: 'rgba(7,5,16,0.62)',
              transition: 'opacity .25s',
              pointerEvents: 'none',
            }}
          />
        )}
        {dims.w > 0 && (
```

(The `ForceGraph3D` block and the closing `)}` `</div>` stay as they are.)

Just before `</section>` (after the `wrapRef` div closes, ~line 511), insert:

```tsx
<StageDrawer />
```

- [ ] **Step 5: Give the Next-step card a stage-complete Advance state**

Replace the `{here && (<HereCard .../>)}` block (lines 413-421) with a branch: when the stage is complete, show an Advance card; otherwise the existing next-step card.

```tsx
{
  stageComplete() ? (
    <AdvanceCard next={nextStageOf(brief.stage)} onAdvance={advanceStage} />
  ) : (
    here && (
      <HereCard
        here={here}
        onStart={() => {
          flyTo(`dept:${here.dept.k}`); // glide to the department…
          briefDepartment(here.dept, here.task); // …byte arrives + orients you in chat
        }}
      />
    )
  );
}
```

Add the `AdvanceCard` component next to `HereCard` (after the `HereCard` function, ~line 587). It reuses `HereCard`'s glass styling:

```tsx
// Shown in place of the next-step card when every current-stage task is done:
// the one move left is to advance the journey. Same overlay slot + styling.
function AdvanceCard({ next, onAdvance }: { next: string | null; onAdvance: () => void }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 126,
        left: 26,
        zIndex: 6,
        width: 264,
        padding: '15px 17px 16px',
        background: 'rgba(16,14,28,0.74)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 14,
        boxShadow: '0 8px 30px rgba(0,0,0,0.45)',
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: '1.4px',
          fontWeight: 700,
          color: 'rgba(52,211,153,.75)',
          textTransform: 'uppercase',
        }}
      >
        Stage complete
      </div>
      <div
        style={{
          fontSize: 15,
          fontWeight: 650,
          color: '#F7F5FF',
          letterSpacing: '-.2px',
          marginTop: 9,
          lineHeight: 1.35,
        }}
      >
        You&apos;ve finished this stage&apos;s work.
      </div>
      {next && (
        <button
          onClick={onAdvance}
          style={{
            marginTop: 15,
            fontFamily: 'inherit',
            fontSize: 13,
            fontWeight: 650,
            color: '#0B0616',
            background: '#F5F3FF',
            border: 0,
            borderRadius: 9,
            padding: '9px 24px',
            cursor: 'pointer',
          }}
        >
          Advance to {next}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Remove the ProgressCard + Meter (dropped meters) and fix the title/layout**

- Delete the `<ProgressCard ... />` usage (lines 405-411).
- Delete the `ProgressCard` function (lines 640-709) and the `Meter` function (lines 608-638).
- Remove **both** `show` and `selectStage` from the `useApp()` destructure — the deleted ProgressCard usage was their only consumer in OverviewView (the ribbon/drawer call `selectStage` via their own `useApp()`). `stageWatermark` stays (used by `mapDimmed`); `nextAction` stays (used by `here`). Confirm `stageIndexOf`/`stageLabelOf`/`currentPhaseName`/`productProgress`/`companyProgress` are already gone (Step 1). Keep `HereCard`.
- The title block (lines 383-403) previously reserved `right: 268` for the ProgressCard. Since the ribbon now sits at the top, move the title below it and drop the reserve. Replace the title block's wrapper style:

```tsx
      <div
        style={{
          position: 'absolute',
          top: 58,
          left: 26,
          right: 26,
          maxWidth: 640,
          zIndex: 5,
          pointerEvents: 'none',
        }}
      >
```

Also bump the `HereCard` overlay `top` from `92` to `126` (so it clears the ribbon + title) — in the `HereCard` function change `top: 92` to `top: 126` (matching `AdvanceCard`).

- [ ] **Step 7: Verify compile, lint, and full suite**

Run: `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint . && ./node_modules/.bin/vitest run`
Expected: 0 tsc errors, eslint exit 0 (no unused imports/vars), all tests pass.

- [ ] **Step 8: Gate + commit**

```bash
./node_modules/.bin/prettier --write components/views/OverviewView.tsx
git add components/views/OverviewView.tsx
git commit -m "feat: wire ribbon + drawer + reactive dim + advance into Overview"
```

---

### Task 5: Retire the Roadmap tab

**Files:**

- Modify: `components/Sidebar.tsx` (remove the Roadmap nav item)
- Modify: `components/AppRoot.tsx` (remove RoadmapView import + render branch)
- Modify: `lib/store.tsx` (drop `'roadmap'` from `View`; reroute `navigateTo` `'roadmap'` → `overview`)
- Modify: `components/views/SummaryView.tsx` (reroute the `show('roadmap')` click)
- Delete: `components/views/RoadmapView.tsx`
- Test: `lib/overview/retirement.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: no `'roadmap'` `View`, no Roadmap route/nav; chat/Summary "roadmap" intents land on the Overview.

- [ ] **Step 1: Write the failing retirement guard test**

Create `lib/overview/retirement.test.ts` (node env; reads source files from the repo root, which is vitest's cwd):

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('Roadmap tab is retired', () => {
  it('AppRoot no longer imports or renders RoadmapView', () => {
    expect(read('components/AppRoot.tsx')).not.toMatch(/RoadmapView/);
  });
  it('Sidebar has no roadmap nav entry', () => {
    expect(read('components/Sidebar.tsx')).not.toMatch(/view:\s*'roadmap'/);
  });
  it('the store View type no longer includes roadmap and never sets it', () => {
    const src = read('lib/store.tsx');
    expect(src).not.toMatch(/\|\s*'roadmap'/); // union member gone
    expect(src).not.toMatch(/setView\('roadmap'\)/); // no route to it
  });
  it('SummaryView does not navigate to the roadmap view', () => {
    expect(read('components/views/SummaryView.tsx')).not.toMatch(/show\('roadmap'\)/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run lib/overview/retirement.test.ts`
Expected: FAIL — all four assertions fail (roadmap references still present).

- [ ] **Step 3: Remove the Sidebar nav item**

In `components/Sidebar.tsx`, delete the entire Roadmap entry object (lines 50-68) — the `{ view: 'roadmap', label: 'Roadmap', icon: (...) }` block, including its trailing comma.

- [ ] **Step 4: Remove the AppRoot import + render branch**

In `components/AppRoot.tsx`:

- Delete the import `import { RoadmapView } from './views/RoadmapView';` (line 18).
- Delete the render branch `) : view === 'roadmap' ? (\n      <RoadmapView />\n    ` (lines 62-64) so the chain goes straight from `home` to `dept`:

```tsx
    ) : view === 'home' ? (
      <CompanyView />
    ) : view === 'dept' ? (
      <DepartmentDetail />
```

- [ ] **Step 5: Retire `'roadmap'` from the store**

In `lib/store.tsx`:

- Remove `| 'roadmap'` from the `View` union (line 89).
- In `navigateTo`, change the `'roadmap'` case body from `setView('roadmap');` to `setView('overview');`:

```tsx
      case 'roadmap':
        setView('overview'); // Roadmap retired — the Overview carries the journey now
        break;
```

(The `NavDest` `'roadmap'` value stays — chat still refers to "roadmap"; it now lands on the Overview. The persisted `roadmapStage` restore and `selStage` are unchanged — the drawer uses them on the Overview.)

- [ ] **Step 6: Reroute SummaryView's "You are here" click**

In `components/views/SummaryView.tsx` line 166, change:

```tsx
        <div className="sum-here" onClick={() => show('roadmap')} role="button" tabIndex={0}>
```

to:

```tsx
        <div className="sum-here" onClick={() => show('overview')} role="button" tabIndex={0}>
```

- [ ] **Step 7: Delete the RoadmapView file**

```bash
git rm components/views/RoadmapView.tsx
```

- [ ] **Step 8: Verify the guard test passes, plus tsc/eslint/full suite**

Run: `./node_modules/.bin/vitest run lib/overview/retirement.test.ts && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint . && ./node_modules/.bin/vitest run`
Expected: retirement test PASS (4); tsc 0 errors (any lingering `setView('roadmap')` would fail the `View` type — there are none); eslint exit 0 (no unused imports left behind); full suite green.

- [ ] **Step 9: Gate + commit**

```bash
./node_modules/.bin/prettier --write components/Sidebar.tsx components/AppRoot.tsx lib/store.tsx components/views/SummaryView.tsx lib/overview/retirement.test.ts
git add -A
git commit -m "feat: retire the Roadmap tab — the Overview is the single home"
```

---

## Manual verification (Vercel preview, after merge or on the PR preview)

The 3D canvas and drawer interactions aren't unit-testable; verify on the prod build preview (not `next dev` — the node_modules symlink breaks it):

1. Overview reads top→bottom: **ribbon** → **next-step card** → **map**.
2. The ribbon shows 5 phases; exactly one is lit "You are here" with a fill; done phases filled, ahead phases faint.
3. Clicking a **non-current** phase opens its checklist drawer and dims the map; closing it restores the lit map.
4. Clicking the **current** phase opens its drawer without dimming.
5. Done tasks/departments visibly recede; the beacon + next-step card still point at the one next task.
6. With every current-stage task done, both the ribbon's current segment and the card surface **Advance to [next]**; clicking advances the stage and re-plans.
7. The **Roadmap** nav entry is gone; asking byte "show me my roadmap" lands on the Overview; Summary's "You are here" opens the Overview.
