# Overview First-Run Spotlight — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Overview's upfront-legend intro modal with a value-first slim card whose CTA actually flies the camera to the lit beacon, spotlights the existing `ByteGuide` callout, and teaches one color in context.

**Architecture:** A new pure module (`lib/overviewIntro.ts`) holds the first-run phase machine so it is unit-testable under the repo's node-env Vitest. `OverviewView` owns the phase state + `localStorage` and drives three thin consumers: the rewritten `OverviewIntro` (slim card), the extended `ByteGuide` (a `spotlight` prop), and a vignette + a "? how to read this map" reopen chip. The handoff reuses the existing `flyTo` and `fitView`; no second "next move" card is created.

**Tech Stack:** Next.js (App Router, SPA), React, TypeScript, `react-force-graph-3d`, Vitest (node env — **no** React Testing Library).

## Global Constraints

- **Branch off `origin/main` in an isolated git worktree** (concurrent sessions drive the primary checkout). Create it at execution time via `superpowers:using-git-worktrees`. Touch only first-run files.
- **Verify first-run on the Vercel PR preview (prod build), NOT `next dev`** — StrictMode double-mount + `resetCompanyData` + HMR make first-run unreadable locally.
- **Lint scoped, never `eslint .`** — the repo's tracked `eslint-suppressions.json` + symlinked worktree `node_modules` make `eslint .` hang/exit 2. Use `npx eslint <changed files>` and `npx tsc --noEmit`.
- **Design north-star:** minimalist, space-forward; no decorative icons/arrows; reuse existing card styling.
- **Retain the localStorage key** `codepet:overview-intro-seen` so users who dismissed the old intro don't see the new one.
- **Guide color** is `#7DE3FF` (mirrors `BEACON_HEX` in `OverviewView`). **State colors** (node legend): `st-does`=`#8B5CF6`, `st-draft`=`#FDB022`, `st-you`=`#3B82F6`, `st-done`=`#34D399`.

---

### Task 1: Pure first-run phase module

**Files:**

- Create: `lib/overviewIntro.ts`
- Test: `lib/overviewIntro.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `INTRO_SEEN_KEY: string` (= `'codepet:overview-intro-seen'`)
  - `GUIDE_HEX: string` (= `'#7DE3FF'`)
  - `type IntroPhase = 'intro' | 'spotlight' | 'done'`
  - `introInitialPhase(seen: boolean): IntroPhase`
  - `onReveal(): IntroPhase` → `'spotlight'`
  - `onSettle(): IntroPhase` → `'done'`
  - `onReopen(): IntroPhase` → `'intro'`
  - `interface HereLike { dept: unknown; task: unknown }`
  - `revealAction(here: HereLike | null): 'fly' | 'recenter'`

- [ ] **Step 1: Write the failing test**

Create `lib/overviewIntro.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  INTRO_SEEN_KEY,
  introInitialPhase,
  onReveal,
  onSettle,
  onReopen,
  revealAction,
} from './overviewIntro';

describe('overview first-run phase machine', () => {
  it('keeps the historical localStorage key', () => {
    expect(INTRO_SEEN_KEY).toBe('codepet:overview-intro-seen');
  });

  it('starts at intro only when the user has not seen it', () => {
    expect(introInitialPhase(false)).toBe('intro');
    expect(introInitialPhase(true)).toBe('done');
  });

  it('CTA reveals the spotlight, which settles to done', () => {
    expect(onReveal()).toBe('spotlight');
    expect(onSettle()).toBe('done');
  });

  it('reopen returns to the intro', () => {
    expect(onReopen()).toBe('intro');
  });
});

describe('revealAction', () => {
  it('flies to the beacon when there is a live next move', () => {
    expect(revealAction({ dept: { k: 'eng' }, task: { t: 'x' } })).toBe('fly');
  });

  it('recenters the map when there is no next move', () => {
    expect(revealAction(null)).toBe('recenter');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- overviewIntro`
Expected: FAIL — `Failed to resolve import "./overviewIntro"`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/overviewIntro.ts`:

```ts
// First-run "spotlight handoff" logic for the Overview, kept pure so it is
// unit-testable under the node-env Vitest (the stack has no React Testing
// Library). The React components — OverviewView / OverviewIntro / ByteGuide —
// are thin consumers of these functions.

// localStorage key — retained from the original OverviewIntro so users who
// already dismissed the old intro are not shown the new one.
export const INTRO_SEEN_KEY = 'codepet:overview-intro-seen';

// The cyan guide-star color the beacon node is painted with on the map, and the
// one contextual color the spotlight teaches. Mirrors BEACON_HEX in OverviewView.
export const GUIDE_HEX = '#7DE3FF';

export type IntroPhase = 'intro' | 'spotlight' | 'done';

// Where a fresh mount starts: show the intro only if the user hasn't seen it.
export function introInitialPhase(seen: boolean): IntroPhase {
  return seen ? 'done' : 'intro';
}

// CTA pressed in the intro → frame the next move.
export function onReveal(): IntroPhase {
  return 'spotlight';
}

// Spotlight acknowledged (Start, timeout) → settle back to the plain map.
export function onSettle(): IntroPhase {
  return 'done';
}

// "? how to read this map" pressed → reopen the explainer.
export function onReopen(): IntroPhase {
  return 'intro';
}

export interface HereLike {
  dept: unknown;
  task: unknown;
}

// What the CTA can actually do: fly to the beacon if there's a live next move,
// otherwise just recenter the whole map (an honest fallback, never a dead fly).
export function revealAction(here: HereLike | null): 'fly' | 'recenter' {
  return here ? 'fly' : 'recenter';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- overviewIntro`
Expected: PASS (all 6 assertions).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add lib/overviewIntro.ts lib/overviewIntro.test.ts
git commit -m "feat(overview): pure first-run phase machine + tests"
```

---

### Task 2: Rewrite OverviewIntro as a controlled slim card

**Files:**

- Modify (full replace): `components/views/overview/OverviewIntro.tsx`

**Interfaces:**

- Consumes: `GUIDE_HEX` from `lib/overviewIntro`.
- Produces: `OverviewIntro({ onReveal, onDismiss, showLegend }: { onReveal: () => void; onDismiss: () => void; showLegend: boolean })` — presentational only. No `localStorage`, no camera. `onReveal` = CTA; `onDismiss` = backdrop click; `showLegend` appends the full color key (true when reopened).

- [ ] **Step 1: Replace the file**

The old `OverviewIntro` self-managed `localStorage` and its CTA was a no-op dismiss. Replace the entire file with the controlled slim card:

```tsx
'use client';
// byte's first-visit welcome on the Overview — a slim, value-first card that
// hands off to the lit next move. Controlled by OverviewView (which owns the
// phase + localStorage); this component only renders and reports intent via
// onReveal / onDismiss. When reopened from "? how to read this map", showLegend
// is true and the full color key is appended.
import { GUIDE_HEX } from '@/lib/overviewIntro';

export default function OverviewIntro({
  onReveal,
  onDismiss,
  showLegend,
}: {
  onReveal: () => void;
  onDismiss: () => void;
  showLegend: boolean;
}) {
  return (
    <div
      onClick={onDismiss}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 8,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'rgba(4,3,10,0.55)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 360,
          maxWidth: '88vw',
          padding: '24px 24px 22px',
          background: 'rgba(16,14,28,0.95)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: `1px solid ${GUIDE_HEX}40`,
          borderRadius: 18,
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: '1.5px',
            fontWeight: 700,
            color: GUIDE_HEX,
            textTransform: 'uppercase',
          }}
        >
          byte · your companion
        </div>
        <div
          style={{
            fontSize: 20,
            fontWeight: 650,
            color: '#F7F5FF',
            letterSpacing: '-.3px',
            marginTop: 10,
            lineHeight: 1.25,
          }}
        >
          I&apos;ll build your company with you — one move at a time.
        </div>
        <div
          style={{ fontSize: 13.5, lineHeight: 1.6, color: 'rgba(245,243,255,.72)', marginTop: 12 }}
        >
          This whole map is your company. I always keep{' '}
          <b style={{ color: '#F5F3FF' }}>one move lit</b> — the single next thing that matters. Let
          me show you.
        </div>

        {showLegend && (
          <div
            style={{
              marginTop: 16,
              paddingTop: 14,
              borderTop: '1px solid rgba(255,255,255,.08)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div
              style={{
                fontSize: 11,
                letterSpacing: '.5px',
                textTransform: 'uppercase',
                color: 'rgba(245,243,255,.5)',
              }}
            >
              What the colors mean
            </div>
            <LegendRow c={GUIDE_HEX} t="Cyan = your next move (always one, lit)" />
            <LegendRow c="#8B5CF6" t="Purple = I'll do it" />
            <LegendRow c="#FDB022" t="Gold = I draft it, you approve" />
            <LegendRow c="#3B82F6" t="Blue = needs you" />
            <LegendRow c="#34D399" t="Green = done" />
          </div>
        )}

        <button
          onClick={onReveal}
          style={{
            marginTop: 20,
            width: '100%',
            fontFamily: 'inherit',
            fontSize: 13.5,
            fontWeight: 700,
            color: '#0B0616',
            background: GUIDE_HEX,
            border: 0,
            borderRadius: 10,
            padding: '11px 26px',
            cursor: 'pointer',
          }}
        >
          Show me my next move ▸
        </button>
        <div
          style={{ fontSize: 11, color: 'rgba(245,243,255,.4)', textAlign: 'center', marginTop: 9 }}
        >
          I&apos;ll explain the map as we go.
        </div>
      </div>
    </div>
  );
}

function LegendRow({ c, t }: { c: string; t: string }) {
  return (
    <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: c,
          boxShadow: `0 0 8px ${c}`,
          flex: 'none',
        }}
      />
      <div style={{ fontSize: 12.5, color: 'rgba(245,243,255,.72)' }}>{t}</div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: FAIL — `OverviewIntro` is still rendered with no props at `components/views/OverviewView.tsx` (`<OverviewIntro />`). This is expected; Task 4 fixes the call site. If any _other_ error appears in this file, fix it.

- [ ] **Step 3: Lint the file**

Run: `npx eslint components/views/overview/OverviewIntro.tsx`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add components/views/overview/OverviewIntro.tsx
git commit -m "feat(overview): slim value-first intro card, controlled by parent"
```

---

### Task 3: Extend ByteGuide with a spotlight prop

**Files:**

- Modify: `components/views/OverviewView.tsx` — the `ByteGuide` function (around lines 655–700) and its type.

**Interfaces:**

- Consumes: nothing new.
- Produces: `ByteGuide({ here, onStart, spotlight }: { here: HereInfo; onStart: () => void; spotlight?: boolean })` — when `spotlight` is true, adds a cyan glow ring (box-shadow only, no layout shift) and one guide-star line. Defaults to the current appearance.

- [ ] **Step 1: Update the signature**

Find:

```tsx
function ByteGuide({ here, onStart }: { here: HereInfo; onStart: () => void }) {
  const st = taskState(here.task, true);
```

Replace with:

```tsx
function ByteGuide({
  here,
  onStart,
  spotlight = false,
}: {
  here: HereInfo;
  onStart: () => void;
  spotlight?: boolean;
}) {
  const st = taskState(here.task, true);
```

- [ ] **Step 2: Add the glow ring**

Find the card's inner `<div>` boxShadow (the one that also sets `borderRadius: 13`):

```tsx
          border: '1px solid rgba(125,227,255,0.35)',
          borderRadius: 13,
          boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
```

Replace the `boxShadow` line with:

```tsx
          border: '1px solid rgba(125,227,255,0.35)',
          borderRadius: 13,
          boxShadow: spotlight
            ? '0 0 0 2px rgba(125,227,255,0.55), 0 0 24px 4px rgba(125,227,255,0.35), 0 8px 30px rgba(0,0,0,0.5)'
            : '0 8px 30px rgba(0,0,0,0.5)',
```

- [ ] **Step 3: Add the guide-star line**

Find the dept · label line:

```tsx
<div style={{ fontSize: 12, marginTop: 5, color: 'rgba(245,243,255,.5)' }}>
  {here.dept.name} · {st.label}
</div>
```

Immediately after that `</div>`, insert:

```tsx
{
  spotlight && (
    <div
      style={{
        marginTop: 9,
        fontSize: 11.5,
        lineHeight: 1.45,
        color: 'rgba(125,227,255,.9)',
      }}
    >
      The bright cyan star is always your next move.
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: `spotlight` is optional, so the existing `<ByteGuide here={here} onStart={...} />` call site still typechecks. Only the pre-existing `<OverviewIntro />` error from Task 2 remains.

- [ ] **Step 5: Commit**

```bash
git add components/views/OverviewView.tsx
git commit -m "feat(overview): ByteGuide gains a spotlight ring + guide-star line"
```

---

### Task 4: Wire the phase machine into OverviewView

**Files:**

- Modify: `components/views/OverviewView.tsx` — imports, `flyTo` signature, new state/handlers, the `<OverviewIntro />` render.

**Interfaces:**

- Consumes: `introInitialPhase`, `revealAction`, `INTRO_SEEN_KEY`, `type IntroPhase` from `lib/overviewIntro`; existing `flyTo`, `fitView`, `beaconId`, `here`, `portalToTask`.
- Produces: `introPhase` state + `handleIntroReveal` / `handleIntroDismiss`, consumed by Task 5's visuals.

- [ ] **Step 1: Add the import**

After the existing `import OverviewIntro from '@/components/views/overview/OverviewIntro';` line, add:

```tsx
import {
  INTRO_SEEN_KEY,
  introInitialPhase,
  revealAction,
  type IntroPhase,
} from '@/lib/overviewIntro';
```

- [ ] **Step 2: Add localStorage helpers**

Directly below the imports (module scope, above `const HEX ...`), add:

```tsx
// First-run "seen" flag. Reads default to seen (true) on failure so we never
// re-trap a user behind a broken storage read.
const readIntroSeen = () => {
  try {
    return !!localStorage.getItem(INTRO_SEEN_KEY);
  } catch {
    return true;
  }
};
const markIntroSeen = () => {
  try {
    localStorage.setItem(INTRO_SEEN_KEY, '1');
  } catch {
    /* ignore */
  }
};
```

- [ ] **Step 3: Add the phase state**

Inside `OverviewView`, right after the `useApp()` destructure block (after `} = useApp();` and `void tick;`), add:

```tsx
// First-run spotlight handoff. OverviewView owns the phase + the localStorage
// flag; OverviewIntro / ByteGuide / the reopen chip are thin consumers.
// OverviewView is imported ssr:false, so reading localStorage in the lazy
// initializer is safe.
const [introPhase, setIntroPhase] = useState<IntroPhase>(() => introInitialPhase(readIntroSeen()));
const [hasSeenIntro, setHasSeenIntro] = useState<boolean>(() => readIntroSeen());
```

- [ ] **Step 4: Make flyTo honor reduced motion**

Find:

```tsx
  const flyTo = (nodeId: string | null) => {
```

Replace with:

```tsx
  const flyTo = (nodeId: string | null, ms = 900) => {
```

Then find the `cameraPosition` call inside `flyTo`:

```tsx
fg.cameraPosition({ x: n.x * k, y: n.y * k, z: n.z * k }, look, 900);
```

Replace with:

```tsx
fg.cameraPosition({ x: n.x * k, y: n.y * k, z: n.z * k }, look, ms);
```

- [ ] **Step 5: Add the handoff handlers + settle effect**

Anchor: place this block **immediately before the `return (`** in `OverviewView`
(around line 440), so `flyTo`, `fitView`, `beaconId`, and `here` are all already
defined above it — avoiding any `no-use-before-define`. Add:

```tsx
// Skip the camera glide (jump-cut) for users who prefer reduced motion.
const introReduceMotion = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// CTA in the intro: remember it's seen, then either fly to the lit beacon or
// (no live move) recenter the whole map, and enter the spotlight.
const handleIntroReveal = () => {
  markIntroSeen();
  setHasSeenIntro(true);
  if (revealAction(here) === 'fly') flyTo(beaconId, introReduceMotion() ? 0 : 900);
  else fitView();
  setIntroPhase('spotlight');
};

// Backdrop click: dismiss without flying, but still mark it seen.
const handleIntroDismiss = () => {
  markIntroSeen();
  setHasSeenIntro(true);
  setIntroPhase('done');
};

// The spotlight is a light touch, not a second modal — auto-settle after a beat.
useEffect(() => {
  if (introPhase !== 'spotlight') return;
  const id = setTimeout(() => setIntroPhase('done'), 6000);
  return () => clearTimeout(id);
}, [introPhase]);
```

- [ ] **Step 6: Replace the intro render**

Find:

```tsx
<OverviewIntro />
```

Replace with:

```tsx
{
  introPhase === 'intro' && (
    <OverviewIntro
      showLegend={hasSeenIntro}
      onReveal={handleIntroReveal}
      onDismiss={handleIntroDismiss}
    />
  );
}
```

- [ ] **Step 7: Typecheck + lint**

Run: `npx tsc --noEmit`
Expected: clean (the `<OverviewIntro />` prop error from Task 2 is now resolved).
Run: `npx eslint components/views/OverviewView.tsx`
Expected: clean. If the `useEffect` trips `react-hooks/exhaustive-deps` for `introPhase`, it is already in the dep array — no change needed.

- [ ] **Step 8: Build + commit**

Run: `npm run build`
Expected: compiles.

```bash
git add components/views/OverviewView.tsx
git commit -m "feat(overview): own first-run phase + wire the intro handoff"
```

---

### Task 5: Spotlight visuals — pass the prop, vignette, reopen chip

**Files:**

- Modify: `components/views/OverviewView.tsx` — the `<ByteGuide />` render, plus two new sibling elements in the returned section.

**Interfaces:**

- Consumes: `introPhase`, `setIntroPhase`, `here`, `portalToTask` from Task 4.
- Produces: the final first-run UX (verified on preview).

- [ ] **Step 1: Pass spotlight + settle on Start**

Find the `ByteGuide` usage:

```tsx
<ByteGuide
  here={here}
  // One shared arrival: byte opens the chat + briefs you, then the
  // portalSignal effect glides the camera to the department AFTER the
  // chat has docked — so the fly frames the settled (narrower) layout
  // instead of being yanked back by the resize-driven auto-fit.
  onStart={() => portalToTask(here.dept.k, here.task.t)}
/>
```

Replace with:

```tsx
<ByteGuide
  here={here}
  spotlight={introPhase === 'spotlight'}
  // One shared arrival: byte opens the chat + briefs you, then the
  // portalSignal effect glides the camera to the department AFTER the
  // chat has docked. Starting also settles any active spotlight.
  onStart={() => {
    setIntroPhase('done');
    portalToTask(here.dept.k, here.task.t);
  }}
/>
```

- [ ] **Step 2: Add the spotlight vignette**

Find the intro render you added in Task 4:

```tsx
{
  introPhase === 'intro' && (
    <OverviewIntro
      showLegend={hasSeenIntro}
      onReveal={handleIntroReveal}
      onDismiss={handleIntroDismiss}
    />
  );
}
```

Immediately after that block, add:

```tsx
{
  introPhase === 'spotlight' && (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 3,
        pointerEvents: 'none',
        background:
          'radial-gradient(closest-side at 50% 50%, rgba(4,3,10,0) 45%, rgba(4,3,10,0.5) 100%)',
      }}
    />
  );
}
```

- [ ] **Step 3: Add the reopen affordance to the existing legend strip**

Both bottom corners are already occupied — the permanent color legend sits
bottom-left, and the app-shell "Ask byte" launcher (`components/Copilot.tsx`)
sits bottom-right. So the reopen control goes as a trailing item **on the
legend strip itself** (semantically correct — it _is_ "how to read this map").
The legend container has `pointerEvents: 'none'`, so the button re-enables its
own clicks with `pointerEvents: 'auto'`.

Find the end of the legend row:

```tsx
        <Legend dot="#34D399" label="Done" />
      </div>
```

Replace with:

```tsx
        <Legend dot="#34D399" label="Done" />
        {introPhase === 'done' && (
          <button
            onClick={() => setIntroPhase('intro')}
            style={{
              pointerEvents: 'auto',
              fontFamily: 'inherit',
              fontSize: 11.5,
              color: 'rgba(245,243,255,.55)',
              background: 'transparent',
              border: 'none',
              borderLeft: '1px solid rgba(245,243,255,.15)',
              paddingLeft: 16,
              cursor: 'pointer',
            }}
          >
            ? how to read this map
          </button>
        )}
      </div>
```

Notes: the button is gated to the `done` phase (hidden during intro/spotlight).
Reopening sets phase `intro` while `hasSeenIntro` is already true, so
`OverviewIntro` renders with the full color key (`showLegend`).

- [ ] **Step 4: Typecheck + lint + build**

Run: `npx tsc --noEmit` → clean.
Run: `npx eslint components/views/OverviewView.tsx` → clean.
Run: `npm run build` → compiles.

- [ ] **Step 5: Commit**

```bash
git add components/views/OverviewView.tsx
git commit -m "feat(overview): spotlight vignette + reopen chip for first-run"
```

- [ ] **Step 6: Push + open PR + preview QA**

Push the branch and open a PR against `origin/main`. On the Vercel PR preview (a fresh browser / incognito so `localStorage` is clean), verify:

1. Fresh visit → the slim intro shows (title "one move at a time", **no** color legend, one CTA).
2. Click **Show me my next move ▸** → camera glides to the lit beacon; the map edges dim (vignette); the `ByteGuide` card shows a cyan ring + "The bright cyan star is always your next move."
3. Hit **Start** on the beacon → normal run loop opens; spotlight is gone.
4. Reload → **no** intro (seen persisted); the map is normal.
5. Click **? how to read this map** (trailing the bottom legend strip) → the intro reopens, this time **with** the full color key.
6. Reduced motion (OS setting on): the CTA jump-cuts to the beacon instead of gliding; ring + line still appear.
7. No-beacon edge (if reachable): CTA recenters the map instead of a dead fly.

Record results in the PR description. Merge only after the preview QA passes (per project practice).

---

## Notes for the executor

- Do **not** touch onboarding, scaffold, the run loop, deliverables, other views, or any files outside `lib/overviewIntro.*` and the two Overview components.
- The only unit-testable unit is Task 1 (pure module); Tasks 2–5 are verified by typecheck/lint/build + the preview QA — this matches the project's "first-run is only readable on the prod preview" reality.
- Keep commits as written (one per task deliverable) for clean review.
