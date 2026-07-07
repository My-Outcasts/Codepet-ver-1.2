# Overview center legibility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the beacon card from covering the map center (auto-frame bias + a card side-flip) and make the progress hero's "next milestone" agree with the breadcrumb.

**Architecture:** A pure `nextPhaseName(stage)` helper feeds the hero the next _phase_ (matching the breadcrumb). `fitView` gains a horizontal bias so the default framing leaves the beacon card's right-side space clear. `ByteGuide` gains a `flip` prop and the tether loop flips the card to whichever side has room. No force-sim / node-layout change.

**Tech Stack:** Next.js 16 / React 19, TypeScript, `react-force-graph-3d` + `three`, node-env Vitest.

## Global Constraints

- **No layout / force-sim change** — node positions untouched (the Design/Marketing label-on-label overlap is the separate deferred layout-evenness pass).
- **Bias only the default framing** — `fitView` (auto/recenter) gets the horizontal bias; `flyTo` / `portalSignal` moves stay unbiased (they frame a specific node; the first-run spotlight must still fly straight to the beacon).
- **No per-frame re-render for the flip** — the tether rAF loop holds the current side in a ref and only `setState`s when it crosses the threshold.
- **Hero component unchanged** — it already renders `nextStage ? "Next: {nextStage} →" : "Final stage"`; only the value it's fed changes.
- **Untouched:** rings + counts (piece 1), parked treatment + unlock reveal (piece 3), breadcrumb, legend, example-plan banner, scaffold, `nextStageOf` everywhere else (AdvanceCard, breadcrumb advance).
- `npm run format:check` before pushing.

---

## File Structure

- **Modify** `lib/stages.ts` — add `nextPhaseName`.
- **Modify** `lib/stages.test.ts` — unit-test `nextPhaseName`.
- **Modify** `components/views/OverviewView.tsx` — `fitView` bias; hero `nextStage` → `nextPhaseName`; `beaconFlip` state + ref + tether-loop compute; `ByteGuide` `flip` prop (transform + arrow).

---

## Task 1: Pure `nextPhaseName` helper

**Files:**

- Modify: `lib/stages.ts`
- Test: `lib/stages.test.ts`

**Interfaces:**

- Consumes: `PHASES` (already imported in `stages.ts`), `currentPhaseName` (already defined there).
- Produces: `nextPhaseName(stage?: string): string | null` — consumed by Task 2.

- [ ] **Step 1: Write the failing test**

Add to `lib/stages.test.ts` (import `nextPhaseName` + `currentPhaseName` from `./stages` and `PHASES` from `./data` — extend the existing imports if present):

```ts
import { nextPhaseName, currentPhaseName } from './stages';
import { PHASES, OB_STAGES } from './data';

describe('nextPhaseName', () => {
  const phaseNames = PHASES.map((p) => p.name);

  it('returns the phase after the current one, or null on the last, for every stage', () => {
    for (const stage of OB_STAGES) {
      const cur = currentPhaseName(stage);
      const i = phaseNames.indexOf(cur);
      const expected = i >= 0 && i < phaseNames.length - 1 ? phaseNames[i + 1] : null;
      expect(nextPhaseName(stage)).toBe(expected);
    }
  });

  it('the last onboarding stage is on the last phase → null (no bogus "next")', () => {
    expect(nextPhaseName(OB_STAGES[OB_STAGES.length - 1])).toBeNull();
  });

  it('an early stage has a real next phase (not null)', () => {
    expect(nextPhaseName(OB_STAGES[0])).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/stages.test.ts`
Expected: FAIL — `nextPhaseName` is not exported.

- [ ] **Step 3: Write the implementation**

In `lib/stages.ts`, directly after `currentPhaseName`, add:

```ts
/** The roadmap phase after the founder's current one (matches the breadcrumb), or null
 *  when they're already in the last phase. Keeps the progress hero's "next milestone"
 *  consistent with the phase breadcrumb (unlike nextStageOf, which uses the finer
 *  onboarding-stage list and runs out first). */
export function nextPhaseName(stage?: string): string | null {
  const cur = currentPhaseName(stage);
  const i = PHASES.findIndex((p) => p.name === cur);
  return i >= 0 && i < PHASES.length - 1 ? PHASES[i + 1].name : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/stages.test.ts`
Expected: PASS (existing stages tests + the 3 new ones).

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit` (only the pre-existing unrelated `firestore.rules.test.ts` errors) and `npx eslint lib/stages.ts lib/stages.test.ts` (clean).

- [ ] **Step 6: Commit**

```bash
git add lib/stages.ts lib/stages.test.ts
git commit -m "feat(stages): nextPhaseName helper (phase-consistent next milestone)"
```

---

## Task 2: Auto-frame bias + hero milestone

**Files:**

- Modify: `components/views/OverviewView.tsx`

**Interfaces:**

- Consumes: `nextPhaseName` (Task 1); the existing `fitView`, `DEPT_R`, the hero `nextMilestone` computation.

- [ ] **Step 1: Import `nextPhaseName`**

Extend the `lib/stages` import (currently `import { stageComplete, nextStageOf } from '@/lib/stages';`):

```ts
import { stageComplete, nextStageOf, nextPhaseName } from '@/lib/stages';
```

- [ ] **Step 2: Feed the hero the next phase**

Find the hero milestone line (`const nextMilestone = nextStageOf(brief.stage);`) and change it to:

```ts
const nextMilestone = nextPhaseName(brief.stage);
```

(Leave the other `nextStageOf(brief.stage)` uses — AdvanceCard, breadcrumb advance — unchanged.)

- [ ] **Step 3: Add the auto-frame bias to `fitView`**

Replace the `fitView` body:

```ts
const fitView = () => {
  const fg = fgRef.current as any;
  if (!fg) return;
  const aspect = dims.w / Math.max(1, dims.h);
  const dist = 360 * Math.max(1, 1.55 / aspect);
  // Bias the composition a touch left so the beacon card (tethered to the right of its
  // node) has clear space and the project center never sits under it.
  const bx = DEPT_R * 0.35;
  fg.cameraPosition({ x: bx, y: 0, z: dist }, { x: bx, y: 0, z: 0 }, 800);
};
```

(`flyTo` — the `cameraPosition({ x: n.x * k, ... })` path — is NOT changed; it frames a specific node.)

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit` (only pre-existing errors); `npx eslint components/views/OverviewView.tsx` (0 errors; no NEW warnings — pre-existing exhaustive-deps warnings may remain).

- [ ] **Step 5: Full suite + commit**

Run: `npx vitest run` (all pass).

```bash
git add components/views/OverviewView.tsx
git commit -m "feat(overview): auto-frame bias + phase-consistent hero milestone"
```

---

## Task 3: Beacon card side-flip

**Files:**

- Modify: `components/views/OverviewView.tsx`

**Interfaces:**

- Consumes: the existing tether rAF loop (`calloutRef`, `graph2ScreenCoords`, `dims.w`), the `ByteGuide` component + its render site.
- Produces: `ByteGuide` renders on whichever side of the beacon has room.

- [ ] **Step 1: Add `beaconFlip` state + ref**

Near the other Overview state/refs (e.g. by `calloutRef`), add:

```ts
const [beaconFlip, setBeaconFlip] = useState(false);
const beaconFlipRef = useRef(false);
```

- [ ] **Step 2: Compute the side in the tether rAF loop**

In the `draw` loop, inside the branch that sets `el.style.transform` (right after computing `sc` and confirming it's on-screen), add the flip decision (ref-guarded so `ByteGuide` re-renders only on a real crossing):

```ts
el.style.opacity = '1';
el.style.transform = `translate(${sc.x}px, ${sc.y}px)`;
const nextFlip = sc.x > dims.w * 0.62;
if (nextFlip !== beaconFlipRef.current) {
  beaconFlipRef.current = nextFlip;
  setBeaconFlip(nextFlip);
}
```

(Setting state inside a `requestAnimationFrame` callback is an event-like update, not a synchronous effect-body `setState` — it does not trip `react-hooks/set-state-in-effect`. The tether `useEffect`'s deps are unchanged, so it is not re-created by this state change.)

- [ ] **Step 3: Pass `flip` to `ByteGuide`**

At the `<ByteGuide ... />` render site (inside the `calloutRef` container), add the prop:

```tsx
            <ByteGuide here={here} onStart={...} spotlight={...} flip={beaconFlip} />
```

(Keep the existing `here` / `onStart` / `spotlight` props exactly as they are.)

- [ ] **Step 4: Add the `flip` prop to `ByteGuide` (transform + arrow)**

In the `ByteGuide` component signature, add `flip = false`:

```tsx
function ByteGuide({
  here,
  onStart,
  spotlight = false,
  flip = false,
}: {
  here: HereInfo;
  onStart: () => void;
  spotlight?: boolean;
  flip?: boolean;
}) {
```

Change the outer wrapper's transform to depend on `flip`:

```tsx
    <div
      style={{
        position: 'relative',
        width: 250,
        transform: flip ? 'translate(calc(-100% - 18px), -50%)' : 'translate(18px, -50%)',
      }}
    >
```

Change the pointer arrow `<span>` so it sits on the side facing the node. Replace the arrow's positional/border style with flip-aware values:

```tsx
<span
  aria-hidden
  style={{
    position: 'absolute',
    ...(flip ? { right: -5 } : { left: -5 }),
    top: '50%',
    width: 10,
    height: 10,
    marginTop: -5,
    background: 'rgba(16,14,28,0.92)',
    ...(flip
      ? {
          borderRight: '1px solid rgba(125,227,255,0.5)',
          borderTop: '1px solid rgba(125,227,255,0.5)',
        }
      : {
          borderLeft: '1px solid rgba(125,227,255,0.5)',
          borderBottom: '1px solid rgba(125,227,255,0.5)',
        }),
    transform: 'rotate(45deg)',
  }}
/>
```

(The card body `<div>` below the arrow is unchanged.)

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit` (only pre-existing errors); `npx eslint components/views/OverviewView.tsx` (0 errors; no NEW warnings).

- [ ] **Step 6: Full suite + format + commit**

Run: `npx vitest run` (all pass), `npm run format:check` (clean; prettier --write if needed).

```bash
git add components/views/OverviewView.tsx
git commit -m "feat(overview): beacon card flips to the side with room (clears center)"
```

---

## Self-Review Notes (author checklist — done)

- **Spec coverage:** auto-frame bias → Task 2 `fitView`; card side-flip → Task 3 (`flip` prop + tether-loop ref-guard); hero milestone consistency → Task 1 helper + Task 2 wiring; edge cases (last phase → null → "Final stage"; no beacon → nothing to flip) covered by the guards.
- **Type consistency:** `nextPhaseName` signature matches the hero's `nextStage: string | null`; `ByteGuide` `flip?: boolean` matches `flip={beaconFlip}`.
- **No placeholders:** every step has full code or exact edits.
- **Guardrails honored:** `flyTo`/portal unbiased; `nextStageOf` kept elsewhere; ref-guarded flip (no per-frame re-render); no layout/force-sim change.
- **Lint traps:** the flip `setState` lives in a rAF callback (not an effect body); tether `useEffect` deps unchanged so it isn't re-created.

```

```
