# Overview roadmap ribbon — breadcrumb — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Overview's five heavy glass stage-cards with a light, text-forward breadcrumb pinned at the top of the map, keeping every existing behavior.

**Architecture:** A pure grouping helper (`lib/overview/ribbonCompact.ts`) partitions the existing `ribbonSegments()` into lead-done / current / trail-ahead for the narrow-width collapse. `StageRibbon.tsx` is rewritten to render two siblings — a full breadcrumb and a compact (collapsed-to-counts) breadcrumb — and a small `app/globals.css` `@media` rule swaps them at 640px. No data, no hooks, no dependencies added.

**Tech Stack:** Next.js 16 / React 19, TypeScript, inline styles + a couple of `globals.css` classes, node-env Vitest (no React Testing Library).

## Global Constraints

- **Keep all current behaviors:** click a phase → `selectStage(stageN)` opens its `StageDrawer`; when `stageComplete()` and the current phase has a `nextStage`, the current pill becomes an "Advance to {nextStage} →" button whose click calls `advanceStage`; re-render on company mutation via the existing `tick` read.
- **Exact palette hexes reused verbatim:** `#34D399` (done, at `rgba(52,211,153,.72)`), `#8B5CF6` (current accents), `#C9B8FF` (progress/%), `#F5F3FF`/`#F7F5FF` (current text), chevron `rgba(255,255,255,.16)`, ahead `rgba(245,243,255,.32)`.
- **No new hooks:** no `ResizeObserver`, `matchMedia`, `useState`, or `useEffect`. The responsive swap is pure CSS at `@media (max-width: 640px)`.
- **CSS owns `display` on the two breadcrumb containers** — NOT inline style. Inline `display` would beat the class and silently break the `@media` swap. The `.stage-ribbon-full` / `.stage-ribbon-compact` classes set `display`/`align-items`/`gap`; the JSX sets only non-layout inline styles on those two divs.
- **Container `pointer-events: none`, interactive items `pointer-events: auto`** (unchanged) so map drag works in the gaps.
- **Remove now-unused constants** (`CARD_BG`, `BORDER`) so `eslint .` stays clean (`no-unused-vars`).
- **Scope:** only `components/views/overview/StageRibbon.tsx`, `lib/overview/ribbonCompact.{ts,test.ts}`, and an appended block in `app/globals.css`. Do not touch `lib/overview/ribbon.ts`, `PHASES`, `lib/stages.ts`, `StageDrawer`, the legend, `openDept`, or the map/graph.
- Run `npm run format:check` before pushing (CI `verify` runs `prettier --check .` repo-wide, incl. docs).

---

## File Structure

- **Create** `lib/overview/ribbonCompact.ts` — pure partition of `RibbonSegment[]` into `{ leadDone, current, trailAhead }`.
- **Create** `lib/overview/ribbonCompact.test.ts` — node-env unit tests for the partition.
- **Rewrite** `components/views/overview/StageRibbon.tsx` — breadcrumb (full + compact) rendering.
- **Modify** `app/globals.css` — append the two ribbon classes + the 640px `@media` swap.

---

## Task 1: Pure compact-grouping helper

**Files:**

- Create: `lib/overview/ribbonCompact.ts`
- Test: `lib/overview/ribbonCompact.test.ts`

**Interfaces:**

- Consumes: `RibbonSegment` from `lib/overview/ribbon.ts` (`{ name: string; state: 'done' | 'current' | 'future'; stageN: number }`).
- Produces: `compactRibbon(segs: RibbonSegment[]): CompactRibbon` and the types `CompactGroup` / `CompactRibbon` (consumed by Task 2).

- [ ] **Step 1: Write the failing test**

Create `lib/overview/ribbonCompact.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { compactRibbon } from './ribbonCompact';
import type { RibbonSegment } from './ribbon';

const seg = (name: string, state: RibbonSegment['state'], stageN: number): RibbonSegment => ({
  name,
  state,
  stageN,
});

describe('compactRibbon', () => {
  it('mid-journey: partitions lead-done / current / trail-ahead', () => {
    const segs = [
      seg('Find', 'done', 1),
      seg('Build', 'done', 2),
      seg('Ship', 'done', 4),
      seg('Launch', 'current', 5),
      seg('Run & grow', 'future', 7),
    ];
    const c = compactRibbon(segs);
    expect(c.leadDone).toEqual({ count: 3, stageN: 1 });
    expect(c.current).toEqual(seg('Launch', 'current', 5));
    expect(c.trailAhead).toEqual({ count: 1, stageN: 7 });
  });

  it('current first: no leadDone', () => {
    const segs = [seg('Find', 'current', 1), seg('Build', 'future', 2), seg('Ship', 'future', 4)];
    const c = compactRibbon(segs);
    expect(c.leadDone).toBeNull();
    expect(c.current?.name).toBe('Find');
    expect(c.trailAhead).toEqual({ count: 2, stageN: 2 });
  });

  it('current last: no trailAhead', () => {
    const segs = [seg('Find', 'done', 1), seg('Build', 'done', 2), seg('Ship', 'current', 4)];
    const c = compactRibbon(segs);
    expect(c.leadDone).toEqual({ count: 2, stageN: 1 });
    expect(c.current?.name).toBe('Ship');
    expect(c.trailAhead).toBeNull();
  });

  it('all done: no current, leadDone covers all, no trailAhead', () => {
    const segs = [seg('Find', 'done', 1), seg('Build', 'done', 2), seg('Ship', 'done', 4)];
    const c = compactRibbon(segs);
    expect(c.current).toBeNull();
    expect(c.leadDone).toEqual({ count: 3, stageN: 1 });
    expect(c.trailAhead).toBeNull();
  });

  it('group stageN is the first constituent phase; deterministic', () => {
    const segs = [seg('Find', 'done', 1), seg('Build', 'done', 2), seg('Ship', 'current', 4)];
    expect(compactRibbon(segs)).toEqual(compactRibbon(segs));
    expect(compactRibbon(segs).leadDone?.stageN).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/overview/ribbonCompact.test.ts`
Expected: FAIL — `Cannot find module './ribbonCompact'`.

- [ ] **Step 3: Write the implementation**

Create `lib/overview/ribbonCompact.ts`:

```ts
// Collapses the stage ribbon for narrow widths: everything before the current
// phase becomes a single "N done" group, everything after a single "N ahead"
// group, the current phase stays whole. Pure partition of ribbonSegments()'s
// output (journey order, at most one 'current'); node-env unit-testable.
import type { RibbonSegment } from './ribbon';

export interface CompactGroup {
  count: number;
  /** Stage to open when the group chip is clicked: the group's first phase. */
  stageN: number;
}

export interface CompactRibbon {
  /** Done phases before the current one, or null if none. */
  leadDone: CompactGroup | null;
  /** The single 'current' phase, or null if the journey is complete. */
  current: RibbonSegment | null;
  /** Future phases after the current one, or null if none. */
  trailAhead: CompactGroup | null;
}

const group = (items: RibbonSegment[]): CompactGroup | null =>
  items.length ? { count: items.length, stageN: items[0].stageN } : null;

export function compactRibbon(segs: RibbonSegment[]): CompactRibbon {
  const i = segs.findIndex((s) => s.state === 'current');
  if (i === -1) {
    // No current phase (journey complete): all remaining are "done" leaders.
    return { leadDone: group(segs), current: null, trailAhead: null };
  }
  return {
    leadDone: group(segs.slice(0, i)),
    current: segs[i],
    trailAhead: group(segs.slice(i + 1)),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/overview/ribbonCompact.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + lint the new files**

Run: `npx tsc --noEmit` (expect only the pre-existing unrelated `firestore.rules.test.ts` errors) and `npx eslint lib/overview/ribbonCompact.ts lib/overview/ribbonCompact.test.ts` (expect clean).

- [ ] **Step 6: Commit**

```bash
git add lib/overview/ribbonCompact.ts lib/overview/ribbonCompact.test.ts
git commit -m "feat(overview): pure compactRibbon helper for narrow-width ribbon collapse"
```

---

## Task 2: Rewrite StageRibbon as a breadcrumb (+ responsive CSS)

**Files:**

- Rewrite: `components/views/overview/StageRibbon.tsx`
- Modify: `app/globals.css` (append at end)

**Interfaces:**

- Consumes: `useApp()` (`selectStage(n: number)`, `advanceStage()`, `brief`, `tick`), `ribbonSegments()` + `RibbonSegment` from `lib/overview/ribbon.ts`, `compactRibbon` + `CompactRibbon` from `lib/overview/ribbonCompact.ts` (Task 1), `currentStageProgress()`, `stageComplete()`, `nextStageOf(stage?)` from `lib/stages.ts`.
- Produces: the default-exported `StageRibbon` component (same import site in `OverviewView.tsx` — no change there).

- [ ] **Step 1: Append the responsive CSS to `app/globals.css`**

Append at the very end of `app/globals.css`:

```css
/* Overview stage ribbon — text-forward breadcrumb. Full row by default;
   below 640px it collapses done/ahead phases to counts (see StageRibbon). */
.stage-ribbon-full {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: nowrap;
}
.stage-ribbon-compact {
  display: none;
  align-items: center;
  gap: 9px;
}
@media (max-width: 640px) {
  .stage-ribbon-full {
    display: none;
  }
  .stage-ribbon-compact {
    display: flex;
  }
}
```

- [ ] **Step 2: Rewrite `components/views/overview/StageRibbon.tsx`**

Replace the entire file with:

```tsx
'use client';
// The stage ribbon — the journey (Find → Build → Ship → Launch → Run & grow)
// as a light, text-forward breadcrumb pinned at the top of the map. Done phases
// are muted-green, the current one gets a pill (name + progress sliver + %), and
// ahead phases are faint — click any to open its checklist (StageDrawer). When
// the current stage is finished the pill offers "Advance to {next} →". On narrow
// widths (CSS, 640px) done/ahead phases collapse to "N done" / "N ahead" counts.
import { Fragment } from 'react';
import { useApp } from '@/lib/store';
import { ribbonSegments, type RibbonSegment } from '@/lib/overview/ribbon';
import { compactRibbon } from '@/lib/overview/ribbonCompact';
import { currentStageProgress, stageComplete, nextStageOf } from '@/lib/stages';

const SCRIM = 'linear-gradient(180deg, rgba(7,5,16,0.82) 0%, rgba(7,5,16,0) 100%)';

export default function StageRibbon() {
  const { selectStage, advanceStage, brief, tick } = useApp();
  void tick; // re-render on company mutation (progress + watermark are live reads)
  const segs = ribbonSegments();
  const pct = currentStageProgress().pct;
  const complete = stageComplete();
  const nextStage = nextStageOf(brief.stage);
  const { leadDone, current, trailAhead } = compactRibbon(segs);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 6,
        padding: '10px 16px',
        background: SCRIM,
        pointerEvents: 'none',
      }}
    >
      {/* Full breadcrumb (default; hidden < 640px by CSS) */}
      <div className="stage-ribbon-full">
        {segs.map((s, i) => (
          <Fragment key={s.name}>
            {i > 0 && <Chevron />}
            <PhaseItem
              seg={s}
              pct={pct}
              complete={complete}
              nextStage={nextStage}
              onOpen={() => selectStage(s.stageN)}
              onAdvance={advanceStage}
            />
          </Fragment>
        ))}
      </div>

      {/* Compact breadcrumb (hidden by default; shown < 640px by CSS) */}
      <div className="stage-ribbon-compact">
        {leadDone && (
          <CountChip
            label={`${leadDone.count} done`}
            tone="done"
            stageN={leadDone.stageN}
            onOpen={selectStage}
          />
        )}
        {leadDone && current && <Chevron />}
        {current && (
          <PhaseItem
            seg={current}
            pct={pct}
            complete={complete}
            nextStage={nextStage}
            onOpen={() => selectStage(current.stageN)}
            onAdvance={advanceStage}
          />
        )}
        {current && trailAhead && <Chevron />}
        {trailAhead && (
          <CountChip
            label={`${trailAhead.count} ahead`}
            tone="ahead"
            stageN={trailAhead.stageN}
            onOpen={selectStage}
          />
        )}
      </div>
    </div>
  );
}

function Chevron() {
  return (
    <span
      aria-hidden
      style={{ color: 'rgba(255,255,255,0.16)', fontSize: 12, pointerEvents: 'none' }}
    >
      ›
    </span>
  );
}

function PhaseItem({
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

  if (current) {
    const canAdvance = complete && !!nextStage;
    return (
      <button
        onClick={canAdvance ? onAdvance : onOpen}
        title={canAdvance ? `Advance to ${nextStage}` : `You are here · ${pct}% through this stage`}
        style={{
          pointerEvents: 'auto',
          cursor: 'pointer',
          fontFamily: 'inherit',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 9,
          padding: '5px 13px',
          borderRadius: 999,
          color: '#F5F3FF',
          background: canAdvance
            ? 'linear-gradient(90deg, rgba(139,92,246,0.28), rgba(52,211,153,0.22))'
            : 'rgba(139,92,246,0.16)',
          border: `1px solid ${canAdvance ? 'rgba(139,92,246,0.55)' : 'rgba(139,92,246,0.4)'}`,
          boxShadow: canAdvance ? '0 0 16px rgba(139,92,246,0.25)' : 'none',
        }}
      >
        {canAdvance ? (
          <>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#F7F5FF' }}>
              Advance to {nextStage}
            </span>
            <span style={{ fontSize: 13, color: '#C9B8FF' }}>→</span>
          </>
        ) : (
          <>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{seg.name}</span>
            <span
              aria-hidden
              style={{
                width: 34,
                height: 4,
                borderRadius: 3,
                background: 'rgba(255,255,255,0.14)',
                position: 'relative',
                overflow: 'hidden',
                display: 'inline-block',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${pct}%`,
                  background: '#C9B8FF',
                }}
              />
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#C9B8FF' }}>{pct}%</span>
          </>
        )}
      </button>
    );
  }

  return (
    <button
      onClick={onOpen}
      title={seg.name}
      style={{
        pointerEvents: 'auto',
        cursor: 'pointer',
        fontFamily: 'inherit',
        background: 'none',
        border: 'none',
        padding: '3px 2px',
        fontSize: 13,
        fontWeight: 600,
        color: done ? 'rgba(52,211,153,0.72)' : 'rgba(245,243,255,0.32)',
      }}
    >
      {seg.name}
    </button>
  );
}

function CountChip({
  label,
  tone,
  stageN,
  onOpen,
}: {
  label: string;
  tone: 'done' | 'ahead';
  stageN: number;
  onOpen: (n: number) => void;
}) {
  return (
    <button
      onClick={() => onOpen(stageN)}
      title={label}
      style={{
        pointerEvents: 'auto',
        cursor: 'pointer',
        fontFamily: 'inherit',
        background: 'none',
        border: 'none',
        padding: '3px 2px',
        fontSize: 12,
        fontWeight: 600,
        color: tone === 'done' ? 'rgba(52,211,153,0.6)' : 'rgba(245,243,255,0.3)',
      }}
    >
      {label}
    </button>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors (only the pre-existing unrelated `firestore.rules.test.ts` errors).

- [ ] **Step 4: Lint the changed files (must be clean — 0 errors)**

Run: `npx eslint components/views/overview/StageRibbon.tsx lib/overview/ribbonCompact.ts`
Expected: 0 errors, 0 warnings (no leftover `CARD_BG`/`BORDER`, no new hooks, no non-null assertions).

- [ ] **Step 5: Run the full unit suite (nothing else regressed)**

Run: `npx vitest run`
Expected: all files pass, including the new `ribbonCompact.test.ts`.

- [ ] **Step 6: Format check**

Run: `npm run format:check`
Expected: clean (if not, `npx prettier --write` the changed files and re-check).

- [ ] **Step 7: Commit**

```bash
git add components/views/overview/StageRibbon.tsx app/globals.css
git commit -m "feat(overview): lighten stage ribbon to a text-forward breadcrumb"
```

---

## Self-Review Notes (author checklist — done)

- **Spec coverage:** breadcrumb states (done/current/future/advance) → Task 2 `PhaseItem`; progress sliver + % → `PhaseItem` current branch; narrow collapse to "N done"/"N ahead" → `compactRibbon` (Task 1) + compact render + CSS (Task 2); click-to-open + advance behaviors → preserved via `selectStage`/`advanceStage`; scrim → `SCRIM`; pointer-events → container/items; edge cases (current first/last, all-done, no-next-stage) → `compactRibbon` returns + `canAdvance = complete && !!nextStage`.
- **Type consistency:** `compactRibbon`/`CompactRibbon`/`CompactGroup` names identical across Tasks 1–2; `RibbonSegment` imported, not redefined; `onOpen: (n: number) => void` on `CountChip` matches `selectStage(n: number)`.
- **No placeholders:** every step has full code/commands.
- **Lint traps pre-empted:** `display` lives in CSS classes (not inline) so the `@media` swap actually applies; unused `CARD_BG`/`BORDER` removed; no new hooks/refs (avoids the React-Compiler plugin that flagged the tame-3d work).

```

```
