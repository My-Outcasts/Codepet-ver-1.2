# Overview Map — Tame the 3D Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Overview 3D map read as a calm radial hub-and-spoke by flattening the department/task layout to a pinned even-ring disc, revealing task labels on zoom, and auto-framing so the beacon card never covers the center — all inside the existing `react-force-graph-3d` renderer.

**Architecture:** A new pure module `lib/overview/layout.ts` computes deterministic in-plane ring positions (unit-tested under node-env Vitest). `OverviewView.tsx` consumes it in its `data` `useMemo`, pins nodes via `fx/fy/fz` (removing the force sim), adds a camera-distance zoom LOD for task labels, and biases `fitView`. No renderer swap, no toggle, no 2D rewrite.

**Tech Stack:** Next.js (App Router SPA), React, TypeScript, `react-force-graph-3d`, `three`, `three-spritetext`, Vitest (node env — **no** React Testing Library).

## Global Constraints

- **Branch off `origin/main` in an isolated git worktree** (concurrent sessions drive the primary checkout); create it at execution time via `superpowers:using-git-worktrees`. Already done for the spec on `feat/overview-tame-3d`. Touch only `lib/overview/layout.*` and `components/views/OverviewView.tsx`.
- **Verify the map on the Vercel PR preview (prod build), NOT `next dev`** — the 3D scene + first-run are not readable locally.
- **Run `npm run format:check` before pushing** — CI's `verify` job runs `prettier --check .` repo-wide; scoped local checks (`tsc`, `eslint <files>`, `vitest`) miss Prettier. Lint warnings do not fail CI; Prettier and `next build` do.
- **Do NOT run `npm run build` in the worktree** — Next's build hangs on the symlinked `node_modules`; rely on `tsc --noEmit` + `vitest` + scoped `eslint`, and the preview.
- **Layout constants (moved into `lib/overview/layout.ts`):** `DEPT_R = 140`, `TASK_R = 46`, `DEPTH = 0.25`, `GOLDEN = Math.PI * (3 - Math.sqrt(5))`.
- **Preserve unchanged:** node colors/sizes (`val`), status encoding, the ribbon, `ByteGuide` beacon + tether, the first-run spotlight (`introPhase`/`flyTo`/vignette/reopen), `pathLinkIds` trail, the bottom legend, `mapDimmed`/`StageDrawer`, and `openDept`.
- **Pre-existing, NOT your findings:** `tsc --noEmit` reports errors in `firestore.rules.test.ts`; `eslint` reports a few `react-hooks/exhaustive-deps` warnings in `OverviewView.tsx`. Neither blocks CI.

---

### Task 1: Pure ring-layout module

**Files:**

- Create: `lib/overview/layout.ts`
- Test: `lib/overview/layout.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `DEPT_R = 140`, `TASK_R = 46`, `DEPTH = 0.25`, `GOLDEN` (all exported `const`)
  - `interface Pos { x: number; y: number; z: number; fx: number; fy: number; fz: number }`
  - `deptRingPosition(index: number, count: number): Pos`
  - `taskRingPosition(dept: { x: number; y: number; z: number }, index: number, total: number): Pos`
  - In both, `fx===x`, `fy===y`, `fz===z` (positions are pinned).

- [ ] **Step 1: Write the failing test**

Create `lib/overview/layout.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deptRingPosition, taskRingPosition, DEPT_R, TASK_R, DEPTH } from './layout';

const hypot2 = (a: number, b: number) => Math.hypot(a, b);

describe('deptRingPosition', () => {
  it('places N departments on a ring of radius DEPT_R at equal angles', () => {
    const count = 8;
    for (let i = 0; i < count; i++) {
      const p = deptRingPosition(i, count);
      expect(hypot2(p.x, p.y)).toBeCloseTo(DEPT_R, 3); // in-plane radius is exact
    }
    // even spacing: dept 0 and dept 2 (a quarter turn apart) are perpendicular
    const p0 = deptRingPosition(0, count);
    const p2 = deptRingPosition(2, count);
    const dot = p0.x * p2.x + p0.y * p2.y;
    expect(dot).toBeCloseTo(0, 3);
  });

  it('compresses depth to at most DEPTH * DEPT_R', () => {
    for (let i = 0; i < 12; i++) {
      const p = deptRingPosition(i, 12);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(DEPT_R * DEPTH + 1e-9);
    }
  });

  it('handles a single department without NaN', () => {
    const p = deptRingPosition(0, 1);
    expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
    expect(hypot2(p.x, p.y)).toBeCloseTo(DEPT_R, 3);
  });

  it('pins positions (fx/fy/fz mirror x/y/z) and is deterministic', () => {
    const a = deptRingPosition(3, 8);
    const b = deptRingPosition(3, 8);
    expect(a).toEqual(b);
    expect([a.fx, a.fy, a.fz]).toEqual([a.x, a.y, a.z]);
  });
});

describe('taskRingPosition', () => {
  const dept = { x: 100, y: 0, z: 0 };

  it('offsets tasks by TASK_R around their department', () => {
    const p = taskRingPosition(dept, 0, 3);
    expect(hypot2(p.x - dept.x, p.y - dept.y)).toBeCloseTo(TASK_R, 3);
  });

  it('never returns non-finite values and pins fx/fy/fz', () => {
    for (let i = 0; i < 5; i++) {
      const p = taskRingPosition(dept, i, 5);
      expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
      expect([p.fx, p.fy, p.fz]).toEqual([p.x, p.y, p.z]);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- overview/layout`
Expected: FAIL — `Failed to resolve import "./layout"`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/overview/layout.ts`:

```ts
// Deterministic radial layout for the Overview map. Departments sit on an even
// ring in the x-y plane; tasks sit on a small ring around their department. A
// little depth (DEPTH of the radius) is kept so the pinned disc parallaxes
// gently as the camera auto-rotates — it is NOT a full sphere. Positions are
// pinned (fx/fy/fz) so the force sim can't re-scatter them. Pure + unit-tested;
// OverviewView is a thin consumer.

export const DEPT_R = 140; // department ring radius
export const TASK_R = 46; // task ring radius around a department
export const DEPTH = 0.25; // fraction of the radius kept as z-depth (parallax)
export const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export interface Pos {
  x: number;
  y: number;
  z: number;
  fx: number;
  fy: number;
  fz: number;
}

const pin = (x: number, y: number, z: number): Pos => ({ x, y, z, fx: x, fy: y, fz: z });

// Department `index` of `count`, evenly spaced starting at the top, clockwise.
// count >= 1 (there is always at least the calling department), so no div-by-zero.
export function deptRingPosition(index: number, count: number): Pos {
  const a = -Math.PI / 2 + (index / count) * Math.PI * 2;
  return pin(Math.cos(a) * DEPT_R, Math.sin(a) * DEPT_R, Math.sin(GOLDEN * index) * DEPT_R * DEPTH);
}

// Task `index` of `total` in a small ring around its department. total >= 1.
export function taskRingPosition(
  dept: { x: number; y: number; z: number },
  index: number,
  total: number,
): Pos {
  const a = (index / total) * Math.PI * 2;
  return pin(
    dept.x + Math.cos(a) * TASK_R,
    dept.y + Math.sin(a) * TASK_R,
    dept.z + Math.sin(GOLDEN * (index + 1)) * TASK_R * DEPTH,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- overview/layout`
Expected: PASS (all assertions).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no new errors (pre-existing `firestore.rules.test.ts` errors only).

```bash
git add lib/overview/layout.ts lib/overview/layout.test.ts
git commit -m "feat(overview): pure deterministic ring layout + tests"
```

---

### Task 2: Flatten & pin the layout in OverviewView

**Files:**

- Modify: `components/views/OverviewView.tsx` — the layout constants, the `data` `useMemo` (project/dept/task seeding), and the force `useEffect`.

**Interfaces:**

- Consumes: `deptRingPosition`, `taskRingPosition` from `lib/overview/layout`.
- Produces: pinned node positions consumed by the renderer; `GOLDEN`/`DEPT_R`/`TASK_R` no longer defined locally (the component uses only the helpers; `DEPT_R` is re-imported later in Task 4 for framing).

- [ ] **Step 1: Add the import**

After the existing `import SpriteText from 'three-spritetext';` line, add:

```tsx
import { deptRingPosition, taskRingPosition } from '@/lib/overview/layout';
```

(Import only the helpers — the component no longer references `DEPT_R`/`TASK_R` directly; they live inside `layout.ts`. Task 4 re-imports `DEPT_R` when it needs it for framing.)

- [ ] **Step 2: Remove the now-duplicated local constants**

Find and delete these three lines near the top of the file:

```tsx
const DEPT_R = 140; // department orbit radius
const TASK_R = 46; // task cluster radius around a department
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
```

(`DEPT_R`/`TASK_R` now come from the import; `GOLDEN` moved into `layout.ts` and is only used by the seeding you are about to replace.)

- [ ] **Step 3: Pin the project (center) node**

Find the project node push:

```tsx
nodes.push({
  id: 'project',
  name: brief.projectName?.trim() || 'Your company',
  kind: 'project',
  color: '#D8D2F5',
  val: 12,
  x: 0,
  y: 0,
  z: 0,
});
```

Replace the `x/y/z` tail with pinned coordinates:

```tsx
nodes.push({
  id: 'project',
  name: brief.projectName?.trim() || 'Your company',
  kind: 'project',
  color: '#D8D2F5',
  val: 12,
  x: 0,
  y: 0,
  z: 0,
  fx: 0,
  fy: 0,
  fz: 0,
});
```

- [ ] **Step 4: Replace the department position math**

Find:

```tsx
const did = `dept:${d.k}`;
const yy = 1 - (di / (DEPTS.length - 1)) * 2;
const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
const th = GOLDEN * di;
const dx = Math.cos(th) * rr * DEPT_R,
  dy = yy * DEPT_R,
  dz = Math.sin(th) * rr * DEPT_R;
const allDone = total > 0 && done === total;
```

Replace with:

```tsx
const did = `dept:${d.k}`;
const dp = deptRingPosition(di, DEPTS.length);
const dx = dp.x,
  dy = dp.y,
  dz = dp.z;
const allDone = total > 0 && done === total;
```

- [ ] **Step 5: Pin the department node**

Find the department node push tail:

```tsx
        sub: `${done}/${total} done · ${d.status === 'attention' ? 'needs you' : d.status}`,
        x: dx,
        y: dy,
        z: dz,
      });
```

Replace with:

```tsx
        sub: `${done}/${total} done · ${d.status === 'attention' ? 'needs you' : d.status}`,
        x: dp.x,
        y: dp.y,
        z: dp.z,
        fx: dp.fx,
        fy: dp.fy,
        fz: dp.fz,
      });
```

- [ ] **Step 6: Replace the task position math + pin the task node**

Find:

```tsx
const st = taskState(t, true);
const tHex = STATE_HEX[st.cls] || '#94A3B8';
const tid = `task:${d.k}:${i}`;
const tyy = 1 - ((i + 0.5) / total) * 2;
const trr = Math.sqrt(Math.max(0, 1 - tyy * tyy));
const tth = GOLDEN * (i + 1);
nodes.push({
  id: tid,
  name: t.t,
  kind: 'task',
  color: rgba(tHex, t.done ? 0.28 : 0.95),
  val: t.done ? 0.7 : 1.1,
  dept: d,
  task: t,
  sub: `${d.name} · ${st.label}`,
  x: dx + Math.cos(tth) * trr * TASK_R,
  y: dy + tyy * TASK_R,
  z: dz + Math.sin(tth) * trr * TASK_R,
});
```

Replace with:

```tsx
const st = taskState(t, true);
const tHex = STATE_HEX[st.cls] || '#94A3B8';
const tid = `task:${d.k}:${i}`;
const tp = taskRingPosition({ x: dx, y: dy, z: dz }, i, total);
nodes.push({
  id: tid,
  name: t.t,
  kind: 'task',
  color: rgba(tHex, t.done ? 0.28 : 0.95),
  val: t.done ? 0.7 : 1.1,
  dept: d,
  task: t,
  sub: `${d.name} · ${st.label}`,
  x: tp.x,
  y: tp.y,
  z: tp.z,
  fx: tp.fx,
  fy: tp.fy,
  fz: tp.fz,
});
```

- [ ] **Step 7: Remove the force sim (positions are now pinned)**

Find and delete this entire effect:

```tsx
// gentle forces (positions are seeded)
useEffect(() => {
  if (!dims.w) return;
  const fg = fgRef.current as any;
  if (!fg) return;
  try {
    fg.d3Force('charge')?.strength(-90);
    fg.d3Force('link')
      ?.distance((l: GLink) => (l.kind === 'pd' ? 95 : 36))
      .strength(0.25);
  } catch {
    /* forces not ready */
  }
}, [dims.w, data]);
```

Pinned `fx/fy/fz` nodes ignore forces, so this block is now inert; removing it keeps the layout purely deterministic.

- [ ] **Step 8: Verify the GNode type allows fx/fy/fz**

Run: `npx tsc --noEmit`
Expected: clean (aside from the pre-existing `firestore.rules.test.ts` errors). `react-force-graph`'s node type includes optional `fx/fy/fz`, so the pushes typecheck. **If** `tsc` reports that `fx`/`fy`/`fz` are not assignable to `GNode`, add them to the `GNode` interface as `fx?: number; fy?: number; fz?: number;` (find `interface GNode` in the file) and re-run — do not widen anything else.

- [ ] **Step 9: Lint + commit**

Run: `npx eslint components/views/OverviewView.tsx`
Expected: 0 errors (pre-existing exhaustive-deps warnings only; no new ones).

```bash
git add components/views/OverviewView.tsx
git commit -m "feat(overview): flatten the map to a pinned even-ring disc"
```

---

### Task 3: Task-label zoom level-of-detail

**Files:**

- Modify: `components/views/OverviewView.tsx` — add `zoomedIn` state + a camera-distance watcher, and render task labels when zoomed in.

**Interfaces:**

- Consumes: `fgRef`, `dims` (existing).
- Produces: `zoomedIn` state read by `nodeThreeObject`.

- [ ] **Step 1: Add the zoom state**

Find the hover state line:

```tsx
const [hoverId, setHoverId] = useState<string | null>(null);
```

Add directly after it:

```tsx
const [zoomedIn, setZoomedIn] = useState(false);
```

- [ ] **Step 2: Add the camera-distance watcher**

Add this effect right after the `measure container` effect (the one that ends with `return () => ro.disconnect();`):

```tsx
// Reveal task labels when the camera is close. Watched per-frame with
// hysteresis (enter < 200, exit > 260) so it doesn't flicker at the threshold;
// on a cross we flip state + refresh so nodeThreeObject re-runs. Task labels
// otherwise stay hidden (hover still shows them via nodeLabel).
useEffect(() => {
  if (!dims.w) return;
  let raf = 0;
  let cur = false;
  const tick = () => {
    const fg = fgRef.current as any;
    const cam = fg?.camera?.();
    if (cam) {
      const d = Math.hypot(cam.position.x, cam.position.y, cam.position.z);
      const next = cur ? d < 260 : d < 200;
      if (next !== cur) {
        cur = next;
        setZoomedIn(next);
        fg.refresh?.();
      }
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}, [dims.w]);
```

- [ ] **Step 3: Render task labels when zoomed in**

Find the top of `nodeThreeObject`:

```tsx
  const nodeThreeObject = (n: GNode): any => {
    if (n.kind === 'task') return undefined; // default sphere; label on hover
    const s = new SpriteText(n.name);
```

Replace those three lines with:

```tsx
  const nodeThreeObject = (n: GNode): any => {
    // Task labels appear only when zoomed in (hover still reveals them via
    // nodeLabel); departments/project always show.
    if (n.kind === 'task' && !zoomedIn) return undefined;
    const s = new SpriteText(n.name);
```

Then find the label sizing line inside the same function:

```tsx
s.textHeight = n.kind === 'project' ? 6 : 4;
```

Replace with (tasks get a smaller label than departments):

```tsx
s.textHeight = n.kind === 'project' ? 6 : n.kind === 'task' ? 3 : 4;
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit` → clean (aside from pre-existing).
Run: `npx eslint components/views/OverviewView.tsx` → 0 errors; the new effect's deps are `[dims.w]` (the rAF closure reads refs, not reactive values) — if eslint flags `react-hooks/exhaustive-deps` here, leave it: adding `fgRef`/`setZoomedIn` is unnecessary (refs/setters are stable) and would not change behavior. Only suppress if it is an **error**, not a warning (warnings don't fail CI).

- [ ] **Step 5: Commit**

```bash
git add components/views/OverviewView.tsx
git commit -m "feat(overview): reveal task labels on zoom-in (LOD)"
```

---

### Task 4: Auto-frame bias (center clear of the beacon card)

**Files:**

- Modify: `components/views/OverviewView.tsx` — the `fitView` function.

**Interfaces:**

- Consumes: `fgRef`, `dims` (existing), and `DEPT_R` (re-imported in this task).
- Produces: framing that leaves the right side clear for the tethered `ByteGuide`.

- [ ] **Step 1: Re-import DEPT_R**

Find the layout import added in Task 2:

```tsx
import { deptRingPosition, taskRingPosition } from '@/lib/overview/layout';
```

Replace it with:

```tsx
import { deptRingPosition, taskRingPosition, DEPT_R } from '@/lib/overview/layout';
```

- [ ] **Step 2: Bias the fit framing**

Find `fitView`:

```tsx
const fitView = () => {
  const fg = fgRef.current as any;
  if (!fg) return;
  const aspect = dims.w / Math.max(1, dims.h);
  const dist = 360 * Math.max(1, 1.55 / aspect);
  fg.cameraPosition({ x: 0, y: 0, z: dist }, { x: 0, y: 0, z: 0 }, 800);
};
```

Replace with:

```tsx
const fitView = () => {
  const fg = fgRef.current as any;
  if (!fg) return;
  const aspect = dims.w / Math.max(1, dims.h);
  // Extra margin (1.7 vs 1.55) + a horizontal pan: shifting the camera and its
  // target right by ~a third of the ring pushes the disc left on screen, so the
  // ring stays framed AND the tethered beacon card on the right never covers
  // the project center. Explicit flyTo/portal moves are unaffected (separate).
  const dist = 360 * Math.max(1, 1.7 / aspect);
  const bx = DEPT_R * 0.35;
  fg.cameraPosition({ x: bx, y: 0, z: dist }, { x: bx, y: 0, z: 0 }, 800);
};
```

- [ ] **Step 3: Typecheck + lint + format**

Run: `npx tsc --noEmit` → clean (aside from pre-existing).
Run: `npx eslint components/views/OverviewView.tsx` → 0 errors.
Run: `npm run format:check` → "All matched files use Prettier code style!" (if it flags any file you touched, run `npx prettier --write <file>` and re-check).

- [ ] **Step 4: Commit**

```bash
git add components/views/OverviewView.tsx
git commit -m "feat(overview): auto-frame bias so the beacon card clears the center"
```

- [ ] **Step 5: Push + open PR + preview QA**

Push the branch and open a PR to `main`. On the Vercel PR preview (prod build), verify:

1. Departments sit on an **even ring** around the center — no label pile-up at the middle, no random scatter.
2. Orbiting shows **gentle parallax** (depth is present) — not a dead-flat plane, not a full sphere.
3. **Hover** a department/task → its label; **zoom in** → task labels appear; **zoom out** → they hide (no flicker at the threshold).
4. The **beacon card** ("byte · do this next") sits to the side; the **project center stays visible** behind/around it.
5. The **first-run spotlight** still flies to and rings the beacon (test in a fresh/incognito browser).
6. Ribbon, legend, `openDept` (click a department), and stage drawer all still work.

Record results in the PR description; merge only after preview QA passes.

---

## Notes for the executor

- Only `lib/overview/layout.*` and `components/views/OverviewView.tsx` may change.
- Task 1 is the only unit-testable unit; Tasks 2–4 are verified by `tsc`/`eslint`/`format:check` + the preview QA (the 3D scene and first-run are not readable under `next dev`).
- Keep the commits as written (one per task) for clean review.
