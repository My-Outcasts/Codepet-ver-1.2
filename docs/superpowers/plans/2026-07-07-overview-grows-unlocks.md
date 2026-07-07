# Overview grows & unlocks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dormant branches read as "for later," and make the map visibly reveal branches unlocking (glow + camera ease + "N areas unlocked" tag) when a stage advance / re-plan re-scaffolds the company.

**Architecture:** A pure `lib/overview/growth.ts` (`unlockedKeys`) diffs the pre/post scaffold dormant set. The store snapshots dormant departments before `scaffoldCompany`, computes the newly-unlocked keys after, and publishes a `growthSignal`. `OverviewView` renders dormant branches as hollow/dashed and, on a growth signal, holds a reveal (glow halo + gentle `flyTo` + transient tag) for ~3s. Reads the scaffold's result only; the active/dormant decision logic is untouched.

**Tech Stack:** Next.js 16 / React 19, TypeScript, `react-force-graph-3d` + `three` + `three-spritetext`, node-env Vitest.

## ⚠️ Base requirement

This piece **builds on piece 1** (PR #94): `makeRingSprite`, `GNode.done/total/pct`, the department branch of `nodeThreeObject`, and `lib/overview/progress.ts`. **Implement off a `main` that already contains #94** (branch fresh once #94 merges). Line numbers below will have shifted — locate edit sites by the named function/branch, not by line. If #94 is not yet merged when execution starts, STOP and escalate.

## Global Constraints

- **Only visualize the scaffold, never change it:** piece 3 reads `DEPTS` before/after `scaffoldCompany` and the `d.later` flags `applyScaffold` sets; it does not alter how active/dormant is decided.
- **Delta is pure + tested:** `unlockedKeys(beforeLater, deptsAfter)` returns dormant-before-and-active-after department keys, in `DEPTS` order.
- **`growthSignal` carries a `ts`** so a repeat unlock of the same keys still fires the reveal.
- **Parked look = hollow + dashed:** `later` departments render a dashed hollow outline (via `makeRingSprite`'s new `parked` mode — no track, no fill), faint node core, "for later" subline, fainter spoke. No `done/total` count. Active departments unchanged (piece-1 ring + count).
- **Reveal:** on a non-empty growth signal, hold `revealKeys` ~3s → glow halo on those dept nodes + a gentle `flyTo` the first unlocked node + a transient centered "✦ N areas unlocked" pill; then settle to normal piece-1 rings. `prefers-reduced-motion` → skip the `flyTo` (keep tag + glow).
- **No new persistence, no new deps.** No completes-&-recedes / momentum. `npm run format:check` before pushing.

---

## File Structure

- **Create** `lib/overview/growth.ts` (+ `.test.ts`) — `GrowthSignal`, `unlockedKeys`.
- **Modify** `lib/store.tsx` — `growthSignal` state + compute in `advanceStage`/`regenerateCompany` + expose.
- **Modify** `components/views/OverviewView.tsx` — parked treatment (`GNode.later`, `makeRingSprite` parked mode) + the reveal.

---

## Task 1: Pure delta helper

**Files:**

- Create: `lib/overview/growth.ts`
- Test: `lib/overview/growth.test.ts`

**Interfaces:**

- Consumes: `Dept` from `lib/data.ts` (`{ k: string; later?: boolean; ... }`).
- Produces: `GrowthSignal`, `unlockedKeys(beforeLater: Set<string>, deptsAfter: Dept[]): string[]` — consumed by Tasks 2 & 4.

- [ ] **Step 1: Write the failing test**

Create `lib/overview/growth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { unlockedKeys } from './growth';
import type { Dept } from '../data';

const dept = (k: string, later: boolean): Dept => ({ k, later }) as unknown as Dept;

describe('unlockedKeys', () => {
  it('returns keys dormant-before and active-after, in order', () => {
    const before = new Set(['mkt', 'sales']);
    const after = [dept('design', false), dept('mkt', false), dept('sales', true)];
    // mkt was dormant→active (unlocked); sales still dormant; design was already active.
    expect(unlockedKeys(before, after)).toEqual(['mkt']);
  });
  it('excludes departments that were already active before', () => {
    const before = new Set<string>(); // nothing was dormant
    const after = [dept('design', false), dept('eng', false)];
    expect(unlockedKeys(before, after)).toEqual([]);
  });
  it('excludes departments still dormant after', () => {
    const before = new Set(['mkt']);
    const after = [dept('mkt', true)];
    expect(unlockedKeys(before, after)).toEqual([]);
  });
  it('empty when nothing changed; preserves DEPTS order for multiple unlocks', () => {
    expect(unlockedKeys(new Set(), [])).toEqual([]);
    const before = new Set(['mkt', 'sales', 'legal']);
    const after = [dept('sales', false), dept('mkt', false), dept('legal', true)];
    expect(unlockedKeys(before, after)).toEqual(['sales', 'mkt']); // after-array order
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/overview/growth.test.ts`
Expected: FAIL — `Cannot find module './growth'`.

- [ ] **Step 3: Write the implementation**

Create `lib/overview/growth.ts`:

```ts
// Detecting graph "growth": which departments just unlocked (dormant → active) when the
// company re-scaffolds on a stage advance / re-plan. Pure + node-env-Vitest-testable.
import type { Dept } from '../data';

export interface GrowthSignal {
  /** Department keys that unlocked (dormant before → active after) this re-scaffold. */
  unlockedKeys: string[];
  /** Distinct timestamp so a repeat unlock of the same keys still fires a reveal. */
  ts: number;
}

// Departments that were dormant before the re-scaffold and are active after.
export function unlockedKeys(beforeLater: Set<string>, deptsAfter: Dept[]): string[] {
  return deptsAfter.filter((d) => beforeLater.has(d.k) && !d.later).map((d) => d.k);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/overview/growth.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit` (only the pre-existing unrelated `firestore.rules.test.ts` errors) and `npx eslint lib/overview/growth.ts lib/overview/growth.test.ts` (clean).

- [ ] **Step 6: Commit**

```bash
git add lib/overview/growth.ts lib/overview/growth.test.ts
git commit -m "feat(overview): pure unlockedKeys helper for graph growth detection"
```

---

## Task 2: Store — growth signal

**Files:**

- Modify: `lib/store.tsx`

**Interfaces:**

- Consumes: `unlockedKeys`, `GrowthSignal` (Task 1); existing `DEPTS`, `scaffoldCompany`, `advanceStage`, `regenerateCompany`.
- Produces (on the `useApp()` value + type): `growthSignal: GrowthSignal | null` — consumed by Task 4.

- [ ] **Step 1: Imports**

Add near the other `lib/overview` / `lib/ai` imports in `lib/store.tsx`:

```ts
import { unlockedKeys, type GrowthSignal } from './overview/growth';
```

(`DEPTS` is already imported.)

- [ ] **Step 2: Type member + state**

In the context type interface (`AppState`), add:

```ts
/** The most recent graph-growth event (branches that unlocked on a re-scaffold), or null. */
growthSignal: GrowthSignal | null;
```

Next to the other `useState` declarations, add:

```ts
const [growthSignal, setGrowthSignal] = useState<GrowthSignal | null>(null);
```

- [ ] **Step 3: Publish the signal in `advanceStage`**

In `advanceStage`, snapshot the dormant set immediately before `scaffoldCompany(companyId, updated)`:

```ts
const beforeLater = new Set(DEPTS.filter((d) => d.later).map((d) => d.k));
scaffoldCompany(companyId, updated).then((changed) => {
  if (changed) {
    // ...existing success work (persistBrief, bump, computeNextStep, chat note)...
    const unlocked = unlockedKeys(beforeLater, DEPTS);
    if (unlocked.length) setGrowthSignal({ unlockedKeys: unlocked, ts: Date.now() });
  } else {
    // ...existing rollback...
  }
});
```

(Place the `beforeLater` snapshot right before the `scaffoldCompany(...)` call, and the `unlocked`/`setGrowthSignal` inside the existing `if (changed)` block, after the existing `bump()`.)

- [ ] **Step 4: Publish the signal in `regenerateCompany`**

Same pattern — snapshot before, publish after:

```ts
const regenerateCompany = useCallback(() => {
  if (!companyId) return;
  toast('Re-planning your company for your stage…');
  const beforeLater = new Set(DEPTS.filter((d) => d.later).map((d) => d.k));
  scaffoldCompany(companyId, brief).then((changed) => {
    if (changed) {
      bump();
      computeNextStep();
      setPlanTailored(true);
      setScaffoldFailed(false);
      toast('Company re-planned for your stage');
      const unlocked = unlockedKeys(beforeLater, DEPTS);
      if (unlocked.length) setGrowthSignal({ unlockedKeys: unlocked, ts: Date.now() });
    } else {
      setScaffoldFailed(true);
      toast('Couldn’t re-plan just now — try again');
    }
  });
}, [companyId, brief, bump, toast, computeNextStep]);
```

(`setGrowthSignal` is a stable state setter — it does NOT need to be added to the `useCallback` dep array.)

- [ ] **Step 5: Expose on the context value**

Add `growthSignal` to the object passed to the provider's `value=` (and, if that object is a `useMemo`, to its dependency array).

- [ ] **Step 6: Typecheck + lint + full suite**

Run: `npx tsc --noEmit` (only pre-existing errors), `npx eslint lib/store.tsx` (0 errors / 0 warnings — the `useCallback` deps are unchanged; `setGrowthSignal`/`DEPTS` are stable and excluded), `npx vitest run` (all pass).

- [ ] **Step 7: Commit**

```bash
git add lib/store.tsx
git commit -m "feat(store): publish growthSignal when a re-scaffold unlocks branches"
```

---

## Task 3: Parked "for later" branch treatment (static)

**Files:**

- Modify: `components/views/OverviewView.tsx`

**Interfaces:**

- Consumes: the piece-1 `makeRingSprite`, `GNode`, department node build, `nodeThreeObject`.
- Produces: `later` departments render hollow/dashed; `makeRingSprite` gains a `parked` mode.

- [ ] **Step 1: Add `later` to `GNode`**

In `interface GNode`, add (near `done?/total?/pct?`):

```ts
  later?: boolean;
```

- [ ] **Step 2: Populate `later` in the department node build**

In the `DEPTS.forEach` department push, add `later: !!d.later,` (alongside `done/total/pct`).

- [ ] **Step 3: Make the dormant spoke fainter**

In the `links.push({ ... })` for the project→dept link, lower the opacity when the department is dormant. Replace the link `color` with a dormant-aware value:

```ts
links.push({
  source: 'project',
  target: did,
  color: rgba(dHex, d.later ? 0.12 : 0.4),
  hex: dHex,
  kind: 'pd',
  active: d.status === 'attention',
});
```

- [ ] **Step 4: Add a `parked` mode to `makeRingSprite`**

Extend the signature and drawing (a dashed hollow outline, no track, no fill):

```ts
function makeRingSprite(pct: number, colorHex: string, size: number, parked = false): THREE.Sprite {
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
  if (parked) {
    // Dormant "for later": a single dashed hollow outline, muted — no track, no fill.
    ctx.setLineDash([S * 0.06, S * 0.06]);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(200,190,230,0.42)';
    ctx.lineWidth = lw * 0.7;
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
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

- [ ] **Step 5: Render the parked treatment in `nodeThreeObject`**

In the department branch of `nodeThreeObject` (the `n.kind === 'dept'` path from piece 1), handle `later` first:

```ts
// Department node.
const radius = Math.cbrt(n.val) * 2.2;

if (n.later) {
  // Parked "for later": hollow dashed outline + muted two-line label, no count/ring.
  const label = new SpriteText(n.name);
  label.color = 'rgba(220,214,245,0.6)';
  label.textHeight = 4;
  label.fontFace = 'Inter, system-ui, sans-serif';
  label.fontWeight = '600';
  (label as any).backgroundColor = 'rgba(7,5,16,0.6)';
  (label as any).padding = 2;
  (label as any).borderRadius = 3;
  (label as any).position.set(0, radius + 5, 0);
  const sub = new SpriteText('for later');
  sub.color = 'rgba(200,190,230,0.4)';
  sub.textHeight = 2.6;
  sub.fontFace = 'Inter, system-ui, sans-serif';
  (sub as any).position.set(0, radius + 1.5, 0);
  const parkedRing = makeRingSprite(0, n.deptColor ?? '#8B5CF6', radius * 3.4, true);
  const group = new THREE.Group();
  group.add(parkedRing);
  group.add(label);
  group.add(sub);
  return group;
}

// ...existing active-department code from piece 1 (label with count + progress ring)...
```

(The label/ring construction for ACTIVE departments — with the `{done}/{total}` count and the filled `makeRingSprite(n.pct, …)` — stays exactly as piece 1 left it, reached only when `!n.later`.)

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit` (only pre-existing errors); `npx eslint components/views/OverviewView.tsx` (0 errors; no NEW warnings — pre-existing exhaustive-deps warnings may remain).

- [ ] **Step 7: Full suite + format + commit**

Run: `npx vitest run` (all pass), `npm run format:check` (clean; prettier --write if needed).

```bash
git add components/views/OverviewView.tsx
git commit -m "feat(overview): parked 'for later' treatment for dormant branches"
```

---

## Task 4: The unlock reveal (dynamic)

**Files:**

- Modify: `components/views/OverviewView.tsx`

**Interfaces:**

- Consumes: `growthSignal` from `useApp()` (Task 2); the piece-1 `data` useMemo, `nodeThreeObject`, `flyTo`, `GNode`.
- Produces: the glow + camera ease + transient tag on unlock.

- [ ] **Step 1: Add `reveal` to `GNode`**

In `interface GNode`, add:

```ts
  reveal?: boolean;
```

- [ ] **Step 2: Reveal state + effect**

Destructure `growthSignal` from `useApp()`. Add state + a timer ref near the other Overview state:

```ts
const [revealKeys, setRevealKeys] = useState<Set<string>>(() => new Set());
const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
```

Add an effect that fires on a new `growthSignal`:

```ts
useEffect(() => {
  if (!growthSignal || growthSignal.unlockedKeys.length === 0) return;
  setRevealKeys(new Set(growthSignal.unlockedKeys));
  // Gentle camera ease toward the first newly-grown branch (skip under reduced motion).
  if (!introReduceMotion()) flyTo(`dept:${growthSignal.unlockedKeys[0]}`, 900);
  if (revealTimer.current) clearTimeout(revealTimer.current);
  revealTimer.current = setTimeout(() => setRevealKeys(new Set()), 3000);
  return () => {
    if (revealTimer.current) clearTimeout(revealTimer.current);
  };
}, [growthSignal]);
```

(`introReduceMotion` and `flyTo` already exist from earlier work. `flyTo` takes a node id `dept:{k}`.)

- [ ] **Step 3: Tag `reveal` onto nodes + rebuild data on reveal change**

The `data` useMemo builds nodes keyed on `[tick, brief.projectName]` (piece 1). Add `revealKeys` to its dependency array, and set `reveal` on each department node:

```ts
        reveal: revealKeys.has(d.k),
```

(Add `revealKeys` to the `useMemo(..., [tick, brief.projectName, revealKeys])` deps so the node objects rebuild when the reveal set changes — start and clear.)

- [ ] **Step 4: Glow halo in `nodeThreeObject`**

For a department node with `n.reveal`, add a bright translucent halo the bloom amplifies. In the ACTIVE-department branch (after building the label + ring group, before returning), add:

```ts
if (n.reveal) {
  const halo = makeGlowSprite(n.deptColor ?? '#7DE3FF', radius * 5.5);
  group.add(halo);
}
```

And add the `makeGlowSprite` module-scope helper next to `makeRingSprite`:

```ts
// A soft radial glow the UnrealBloomPass amplifies — used to flash a just-unlocked branch.
function makeGlowSprite(colorHex: string, size: number): THREE.Sprite {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, colorHex);
  g.addColorStop(0.4, colorHex);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  sprite.scale.set(size, size, 1);
  return sprite;
}
```

- [ ] **Step 5: Transient "N areas unlocked" tag**

Render a centered pill under the breadcrumb while `revealKeys.size > 0`. Add after `<StageRibbon />` (near the other absolute overlays):

```tsx
{
  revealKeys.size > 0 && (
    <div
      style={{
        position: 'absolute',
        top: 52,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 7,
        pointerEvents: 'none',
        padding: '6px 14px',
        borderRadius: 999,
        background: 'rgba(16,14,28,0.92)',
        border: '1px solid rgba(125,227,255,0.4)',
        color: '#7DE3FF',
        fontSize: 12,
        fontWeight: 700,
        fontFamily: 'inherit',
        boxShadow: '0 0 20px rgba(125,227,255,0.25)',
      }}
    >
      ✦ {revealKeys.size} {revealKeys.size === 1 ? 'area' : 'areas'} unlocked
    </div>
  );
}
```

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit` (only pre-existing errors); `npx eslint components/views/OverviewView.tsx` — 0 errors and no NEW warnings. Watch the reveal `useEffect` deps: `[growthSignal]` is correct (it reads `growthSignal`, and `flyTo`/`introReduceMotion`/setters are stable module/`useCallback` refs — if the React-Compiler plugin demands `flyTo`, add it, but do not add the stable setters).

- [ ] **Step 7: Full suite + format + commit**

Run: `npx vitest run` (all pass), `npm run format:check` (clean; prettier --write if needed).

```bash
git add components/views/OverviewView.tsx
git commit -m "feat(overview): unlock reveal — glow + camera ease + transient tag"
```

---

## Self-Review Notes (author checklist — done)

- **Spec coverage:** delta detection → Task 1 `unlockedKeys` + Task 2 store signal; parked look → Task 3 (`later` flag, `makeRingSprite` parked mode, faint spoke, "for later"); reveal → Task 4 (revealKeys hold, glow halo, `flyTo`, transient tag, reduced-motion skip of camera); edge cases (nothing unlocked → no signal → no reveal) → Task 2 `if (unlocked.length)` guard + Task 4 empty-guard.
- **Type consistency:** `GrowthSignal`/`unlockedKeys` names identical across Tasks 1→2→4; `GNode` gains `later` (Task 3) + `reveal` (Task 4) matching the node build + `nodeThreeObject` reads.
- **Renderer correctness:** `data` memo gains `revealKeys` dep so glow adds/removes on reveal change; `nodeThreeObjectExtend` and piece-1 active-branch rendering preserved; halo uses additive blending for the existing bloom; parked branch returns its own group (no count/ring).
- **Lint traps pre-empted:** reveal `useEffect` dep is `[growthSignal]`; `setGrowthSignal` not added to `regenerateCompany`'s `useCallback` deps (stable); no new persistence.
- **Dependency:** explicitly requires piece 1 (#94) in the base — Task 3/4 edit piece-1 constructs by name, not line number.

```

```
