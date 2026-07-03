# Cinematic Intro + Fast, Alive Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Codepet's first-run (splash + onboarding) cinematic and dreamy, shrink shipped image weight from ~40 MB to ~5 MB, and give in-app department images a light "materialize" reveal — presentation only, no flow/logic changes.

**Architecture:** A build-time `sharp` script re-encodes every `public/` image to WebP (covers also to AVIF) and the render sites switch to the new formats; two small reusable client primitives — a `useParallax` hook (writes `--px`/`--py` CSS vars) and a `<Starfield>` particle component — feed CSS-driven cinematic layers on the splash and onboarding; in-app covers get a CSS-only load reveal + hover shine. All heavy motion collapses under two media guardrails.

**Tech Stack:** Next.js 16 App Router, React, TypeScript, CSS (`app/globals.css`), `sharp` 0.34.5 (dev/build-time), Vitest (`*.test.ts`, node env), `node --test` for `.mjs` helpers.

## Global Constraints

_Every task's requirements implicitly include this section. Copy these verbatim into each reviewer dispatch._

- **GPU-safe motion only:** animate `transform` / `opacity` / `scale` only. **NEVER** animate `filter: blur()` on an image at a high radius — that is exactly what tanked the nebula (~1.2 s/frame on iPhone). All "glow" is a pre-blurred **radial-gradient layer**, not runtime blur of an image.
- **`@media (max-width: 820px)` mobile-lite:** strip parallax, particles, and sweeps — static image + simple fade. (No such block exists for the intro yet; Task 8 creates it.)
- **`@media (prefers-reduced-motion: reduce)`:** disable Ken Burns, parallax, particles, sweeps, and crossfades; keep instant static states. (An existing block lives at `app/globals.css:7276`; Task 8 extends it.)
- **Image encoding:** WebP quality **80**; AVIF quality **50** and AVIF is generated for **covers only** (they dominate weight). Cap the longest edge at **1600px** for covers, **1920px** for full-bleed scene images (onboarding / splash / loading / auth).
- **SSR-safe client primitives:** every `window` / `matchMedia` / pointer access is guarded; components render nothing on the server path rather than throwing or mismatching hydration.
- **Do NOT touch Giang's Build Coach files** (`BuildCoachView`, `InstallView`, `SummaryView`, `app/api/track*`, `app/api/build-plan`, `app/actions/install.ts`, the installer core, `toolkit/hooks`). Splash, Onboarding, CompanyView, DepartmentDetail, and `globals.css` are all ours.
- **Keep the existing minimalist aesthetic** — richer, not gaudy.
- **DEFERRED — flag to user (byte bloom):** the spec (§3, §4) mentions "byte gets a soft bloom" / "byte boots in." The current `Splash.tsx` and the cold-open (`Onboarding.tsx` step 0) do **not** render a `<Byte>` mascot. Adding one is a content change, outside "presentation only," and unreviewed UI (per the "discuss UI before implementing" preference). This plan implements every other effect and **defers byte-bloom** — surface it to the user as a follow-up; do not invent a mascot placement.

---

## File Structure

**Create:**
- `scripts/optimize-images.mjs` — build-time re-encode pipeline (pure helpers + guarded `main()`).
- `scripts/optimize-images.test.mjs` — `node --test` unit tests for the pure helpers.
- `lib/ui/useParallax.ts` — `clampNorm` pure helper + `useParallax(ref)` hook.
- `lib/ui/useParallax.test.ts` — Vitest tests for `clampNorm`.
- `components/ui/Starfield.tsx` — client-gated drifting particle layer.
- `public/covers/*.{webp,avif}`, `public/onboarding/*.webp`, `public/{splash,loading,auth}.webp` — generated assets (committed in Task 1).

**Modify:**
- `app/layout.tsx` — preload the first splash image.
- `components/views/CompanyView.tsx:45` — cover ref → `image-set(avif, webp)`.
- `components/views/DepartmentDetail.tsx:113` — cover ref → `image-set(avif, webp)`.
- `components/Splash.tsx` — parallax root, `<Starfield>`, glow layer, word-split subtitle.
- `components/Onboarding.tsx` — `STEP_ART` refs → `.webp`; cold-open parallax/starfield/glow; layered crossfade art panel with per-step color-grade.
- `app/globals.css` — new cinematic layers, dept reveal, and both guardrail blocks.

**Delete (Task 2):** `public/covers/*.png` (8), `public/onboarding/*.jpg` (8, incl. the unused `ob-vortex.jpg`), `public/{splash,loading,auth}.jpg` (3), and the orphaned `public/onboarding/ob-vortex.webp`.

---

### Task 1: Image optimization pipeline + generate assets

**Files:**
- Create: `scripts/optimize-images.mjs`
- Test: `scripts/optimize-images.test.mjs`
- Generated (committed): `public/covers/*.{webp,avif}`, `public/onboarding/*.webp`, `public/{splash,loading,auth}.webp`

**Interfaces:**
- Consumes: `sharp` 0.34.5 (installed).
- Produces (named exports the test + later reasoning rely on):
  - `encodePlan(relPath: string) → { formats: string[], maxEdge: number, webpQuality: number, avifQuality: number }`
  - `siblingPath(absPath: string, format: string) → string`
  - Asset naming: `covers/eng.png → covers/eng.webp` + `covers/eng.avif`; `onboarding/ob-team.jpg → onboarding/ob-team.webp`; `splash.jpg → splash.webp`.

This task adds the pipeline and generates the new assets, but leaves the originals and all references untouched (the app still renders the PNG/JPG). The cutover is Task 2 — keeping them separate means each task leaves a working app.

- [ ] **Step 1: Write the failing test**

Create `scripts/optimize-images.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodePlan, siblingPath } from './optimize-images.mjs';

test('covers get webp + avif at 1600px', () => {
  const p = encodePlan('covers/eng.png');
  assert.deepEqual(p.formats, ['webp', 'avif']);
  assert.equal(p.maxEdge, 1600);
  assert.equal(p.webpQuality, 80);
  assert.equal(p.avifQuality, 50);
});

test('scene images get webp only at 1920px', () => {
  assert.deepEqual(encodePlan('splash.jpg').formats, ['webp']);
  assert.equal(encodePlan('splash.jpg').maxEdge, 1920);
  assert.deepEqual(encodePlan('onboarding/ob-team.jpg').formats, ['webp']);
});

test('siblingPath swaps the extension case-insensitively', () => {
  assert.equal(siblingPath('/pub/covers/eng.png', 'webp'), '/pub/covers/eng.webp');
  assert.equal(siblingPath('/pub/covers/eng.png', 'avif'), '/pub/covers/eng.avif');
  assert.equal(siblingPath('/pub/onboarding/ob-team.JPG', 'webp'), '/pub/onboarding/ob-team.webp');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/optimize-images.test.mjs`
Expected: FAIL — cannot resolve `./optimize-images.mjs` (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `scripts/optimize-images.mjs`:

```js
// Build-time image pipeline: re-encode public/ art to WebP (covers also to AVIF).
// Run:  node scripts/optimize-images.mjs [--force]
// Idempotent: skips an output that already exists unless --force. Fails loudly
// per-file without aborting the batch. Originals are removed in a later commit.
import sharp from 'sharp';
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(process.cwd(), 'public');

// Which formats/size/quality a source gets, keyed by its public-relative path.
export function encodePlan(relPath) {
  if (relPath.startsWith('covers/')) {
    return { formats: ['webp', 'avif'], maxEdge: 1600, webpQuality: 80, avifQuality: 50 };
  }
  return { formats: ['webp'], maxEdge: 1920, webpQuality: 80, avifQuality: 50 };
}

// Same path with a new extension (png/jpg/jpeg → format).
export function siblingPath(absPath, format) {
  return absPath.replace(/\.(png|jpe?g)$/i, '.' + format);
}

async function collectSources() {
  const out = [];
  for (const [dir, exts] of [
    ['covers', ['.png']],
    ['onboarding', ['.jpg', '.jpeg']],
  ]) {
    const abs = path.join(PUBLIC, dir);
    if (!existsSync(abs)) continue;
    for (const f of await readdir(abs)) {
      if (exts.includes(path.extname(f).toLowerCase())) out.push(`${dir}/${f}`);
    }
  }
  for (const f of ['splash.jpg', 'loading.jpg', 'auth.jpg']) {
    if (existsSync(path.join(PUBLIC, f))) out.push(f);
  }
  return out;
}

async function main() {
  const force = process.argv.includes('--force');
  const sources = await collectSources();
  let made = 0,
    skipped = 0,
    failed = 0;
  for (const rel of sources) {
    const input = path.join(PUBLIC, rel);
    const plan = encodePlan(rel);
    for (const format of plan.formats) {
      const out = siblingPath(input, format);
      if (!force && existsSync(out)) {
        skipped++;
        continue;
      }
      const quality = format === 'avif' ? plan.avifQuality : plan.webpQuality;
      try {
        await sharp(input)
          .resize({ width: plan.maxEdge, height: plan.maxEdge, fit: 'inside', withoutEnlargement: true })
          .toFormat(format, { quality })
          .toFile(out);
        made++;
        console.log(`✓ ${path.relative(PUBLIC, out)}`);
      } catch (err) {
        failed++;
        console.error(`✗ ${rel} → ${format}: ${err.message}`);
      }
    }
  }
  console.log(`\ndone: ${made} written, ${skipped} skipped, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

// Only run the batch when invoked directly — importing for tests must not convert.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/optimize-images.test.mjs`
Expected: PASS — 3 tests, 0 failures. (Importing the module must NOT print any `✓ …` conversion lines — proves the direct-invocation guard works.)

- [ ] **Step 5: Generate the assets**

Run: `node scripts/optimize-images.mjs`
Expected: prints `✓ covers/eng.webp`, `✓ covers/eng.avif`, … `✓ splash.webp`, … and a final `done: 27 written, 0 skipped, 0 failed` line (8 covers ×2 = 16, 8 onboarding ×1 = 8, 3 top-level ×1 = 3 → 27).

- [ ] **Step 6: Verify the new weight**

Run: `du -sh public/covers/*.webp public/covers/*.avif public/onboarding/*.webp public/*.webp | tail -1; echo '---'; du -ch public/**/*.webp public/**/*.avif public/*.webp 2>/dev/null | tail -1`
Expected: the WebP/AVIF total is a small fraction of the 40 MB originals (target ≈ 5 MB or less). If covers AVIF is not dramatically smaller than the PNG, note it but do not block.

- [ ] **Step 7: Commit**

```bash
git add scripts/optimize-images.mjs scripts/optimize-images.test.mjs public/covers/*.webp public/covers/*.avif public/onboarding/*.webp public/splash.webp public/loading.webp public/auth.webp
git commit -m "feat(images): sharp pipeline generates webp/avif siblings for all public art"
```

---

### Task 2: Cutover — swap references, delete originals, preload + content-visibility

**Files:**
- Modify: `components/views/CompanyView.tsx:45`
- Modify: `components/views/DepartmentDetail.tsx:113`
- Modify: `components/Onboarding.tsx:36-45` (`STEP_ART`)
- Modify: `app/globals.css` (4 `url(...)` background refs: `.splash::before` 3142, `.loadscr::before` 3177, `.ob-cold::after` 3327, `.signin::before` 7047; plus `content-visibility` on `.deptrow`)
- Modify: `app/layout.tsx` (preload link)
- Delete: originals listed in File Structure

**Interfaces:**
- Consumes: the generated siblings + naming from Task 1.
- Produces: an app that references only WebP/AVIF; no `.png` cover or `splash/loading/auth.jpg` string remains in source.

This is the cutover. After it, the originals are gone and everything renders from the optimized formats. Covers (which have AVIF) use `image-set()`; the scene backgrounds (WebP only) use plain `url()`.

- [ ] **Step 1: Swap the two cover render sites to `image-set`**

In `components/views/CompanyView.tsx:45`, replace the `dr-img` style:

```tsx
              <div
                className="dr-img"
                style={{
                  backgroundImage: `image-set(url('/covers/${dep.k}.avif') type('image/avif'), url('/covers/${dep.k}.webp') type('image/webp'))`,
                }}
              >
```

In `components/views/DepartmentDetail.tsx:113`, replace the `dhero2` style:

```tsx
        <div
          className="dhero2"
          style={{
            backgroundImage: `image-set(url('/covers/${d.k}.avif') type('image/avif'), url('/covers/${d.k}.webp') type('image/webp'))`,
          }}
        >
```

- [ ] **Step 2: Swap `STEP_ART` to `.webp`**

In `components/Onboarding.tsx`, replace the `STEP_ART` array (lines 36–45) so every entry ends in `.webp`:

```tsx
const STEP_ART = [
  '/onboarding/ob-team.webp', // 0 cold-open
  '/onboarding/ob-couch.webp', // 1 name
  '/onboarding/ob-chess.webp', // 2 role
  '/onboarding/ob-drummer.webp', // 3 tech
  '/onboarding/ob-observatory.webp', // 4 project
  '/onboarding/ob-isometric.webp', // 5 stage
  '/onboarding/ob-boardroom.webp', // 6 analysis
  '/onboarding/ob-team.webp', // 7 summary
];
```

- [ ] **Step 3: Swap the four CSS background refs to `.webp`**

In `app/globals.css`:
- Line ~3142 `.splash::before`: `background: url('/splash.jpg') …` → `url('/splash.webp') …`
- Line ~3177 `.loadscr::before`: `url('/loading.jpg')` → `url('/loading.webp')`
- Line ~3327 `.ob-cold::after`: `url('/onboarding/ob-team.jpg')` → `url('/onboarding/ob-team.webp')`
- Line ~7047 `.signin::before`: `url('/auth.jpg')` → `url('/auth.webp')`

- [ ] **Step 4: Add `content-visibility` to the department rows**

In `app/globals.css`, add to the `.deptrow` rule (find it via `grep -n "^.deptrow" app/globals.css`) these two declarations:

```css
  content-visibility: auto;
  contain-intrinsic-size: auto 128px;
```

- [ ] **Step 5: Preload the first splash image**

In `app/layout.tsx`, inside `<head>` after the font `<link>`s (before `</head>`), add:

```tsx
        <link rel="preload" as="image" href="/splash.webp" />
```

- [ ] **Step 6: Delete the originals**

```bash
rm public/covers/*.png
rm public/onboarding/*.jpg
rm public/splash.jpg public/loading.jpg public/auth.jpg
rm -f public/onboarding/ob-vortex.webp
```

(`ob-vortex` is unreferenced — grep confirms `STEP_ART` never uses it and nothing else does; drop both its original and its generated webp.)

- [ ] **Step 7: Verify no stale references remain**

Run: `grep -rn "\.png'\|/covers/.*\.png\|splash\.jpg\|loading\.jpg\|auth\.jpg\|onboarding/ob-.*\.jpg" app components lib`
Expected: no matches for any cover `.png` or `splash/loading/auth.jpg` or `onboarding/*.jpg`. (Matches for unrelated `.png` assets elsewhere are fine — confirm they are not the ones just deleted.)

Run: `ls public/covers public/onboarding public/*.webp`
Expected: `covers/` holds only `.webp` + `.avif`; `onboarding/` holds only `.webp` (no `ob-vortex`); `public/splash.webp public/loading.webp public/auth.webp` exist.

- [ ] **Step 8: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS (no new errors; the pre-existing `firestore.rules.test.ts` env errors are baseline and unrelated — see Task-8 note).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(images): cut every render site over to webp/avif, drop 40MB of originals, preload splash"
```

---

### Task 3: `useParallax` hook

**Files:**
- Create: `lib/ui/useParallax.ts`
- Test: `lib/ui/useParallax.test.ts`

**Interfaces:**
- Produces:
  - `clampNorm(value: number, min: number, max: number) → number` — maps `value` in `[min,max]` to `[-1,1]`, clamped; returns `0` for a degenerate range.
  - `useParallax(ref: RefObject<HTMLElement | null>) → void` — on `pointermove` within `ref`, writes rAF-throttled `--px`/`--py` (−1..1) onto `ref.current`. No-ops under reduced-motion or coarse pointer; SSR-safe.

- [ ] **Step 1: Write the failing test**

Create `lib/ui/useParallax.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { clampNorm } from './useParallax';

describe('clampNorm', () => {
  it('maps the midpoint to 0', () => {
    expect(clampNorm(50, 0, 100)).toBe(0);
  });
  it('maps the ends to -1 and 1', () => {
    expect(clampNorm(0, 0, 100)).toBe(-1);
    expect(clampNorm(100, 0, 100)).toBe(1);
  });
  it('clamps beyond the range', () => {
    expect(clampNorm(150, 0, 100)).toBe(1);
    expect(clampNorm(-50, 0, 100)).toBe(-1);
  });
  it('returns 0 for a zero-width range', () => {
    expect(clampNorm(5, 5, 5)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ui/useParallax.test.ts`
Expected: FAIL — cannot resolve `./useParallax`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/ui/useParallax.ts`:

```ts
'use client';
import { useEffect } from 'react';
import type { RefObject } from 'react';

// Map a value in [min,max] onto [-1,1], clamped. Degenerate range → 0.
export function clampNorm(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  const f = ((value - min) / (max - min)) * 2 - 1;
  return Math.max(-1, Math.min(1, f));
}

// On pointer move within `ref`, write rAF-throttled --px/--py (−1..1) onto the
// element for CSS layers to consume. No-op under reduced-motion / coarse pointer.
export function useParallax(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === 'undefined' || !window.matchMedia) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (window.matchMedia('(pointer: coarse)').matches) return;

    let raf = 0;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const px = clampNorm(e.clientX, r.left, r.right);
      const py = clampNorm(e.clientY, r.top, r.bottom);
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        el.style.setProperty('--px', px.toFixed(3));
        el.style.setProperty('--py', py.toFixed(3));
      });
    };
    el.addEventListener('pointermove', onMove);
    return () => {
      el.removeEventListener('pointermove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ui/useParallax.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/ui/useParallax.ts lib/ui/useParallax.test.ts
git commit -m "feat(ui): useParallax hook — pointer → clamped --px/--py CSS vars, gated off on reduce/coarse"
```

---

### Task 4: `<Starfield>` component

**Files:**
- Create: `components/ui/Starfield.tsx`
- Modify: `app/globals.css` (add `.starfield` styles + `twinkle` keyframes)

**Interfaces:**
- Consumes: nothing (self-contained).
- Produces: `<Starfield />` — a client component rendering a drifting particle layer, or `null` when reduced-motion / `max-width:820px` / coarse pointer. Drift consumes the ancestor's `--px`/`--py` via CSS, so it must be mounted inside a `useParallax` root.

No unit test: the project has no component-render harness (Vitest runs in `node` env, no jsdom) and the spec asks only for the `optimize-images`/`useParallax` unit tests. This task is gated on typecheck + lint + manual preview.

- [ ] **Step 1: Write the component**

Create `components/ui/Starfield.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';

// Deterministic scatter — index-derived so server and client agree (no hydration
// mismatch) and no Math.random at module scope.
const DOTS = Array.from({ length: 40 }, (_, i) => ({
  x: (i * 37) % 100,
  y: (i * 61) % 100,
  size: 1 + (i % 3),
  dur: 6 + (i % 5) * 2,
  delay: (i % 7) * 0.9,
}));

// A lightweight drifting particle layer for the splash / cold-open. Renders
// nothing under reduced-motion, mobile-lite, or coarse pointers. Client-only
// (mounts to false first) so it never mismatches the server render.
export function Starfield() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const mobile = window.matchMedia('(max-width: 820px)').matches;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    setOn(!reduced && !mobile && !coarse);
  }, []);

  if (!on) return null;
  return (
    <div className="starfield" aria-hidden>
      {DOTS.map((p, i) => (
        <i
          key={i}
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            animationDuration: `${p.dur}s`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Add the styles**

In `app/globals.css`, in the `/* ===== splash & onboarding motion ===== */` section (after the `hintPulse` keyframes, ~line 6983), add:

```css
/* drifting particle layer (Starfield) — parallax via ancestor --px/--py */
.starfield {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  overflow: hidden;
  transform: translate3d(calc(var(--px, 0) * 6px), calc(var(--py, 0) * 6px), 0);
}
.starfield i {
  position: absolute;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.75);
  box-shadow: 0 0 6px rgba(180, 150, 255, 0.7);
  opacity: 0;
  animation-name: twinkle;
  animation-iteration-count: infinite;
  animation-timing-function: ease-in-out;
}
@keyframes twinkle {
  0%,
  100% {
    opacity: 0.1;
    transform: translateY(0);
  }
  50% {
    opacity: 0.8;
    transform: translateY(-6px);
  }
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/ui/Starfield.tsx app/globals.css
git commit -m "feat(ui): Starfield particle layer — client-gated, deterministic scatter, parallax drift"
```

---

### Task 5: Cinematic splash

**Files:**
- Modify: `components/Splash.tsx`
- Modify: `app/globals.css` (glow layer, title sweep, word-rise on subtitle)

**Interfaces:**
- Consumes: `useParallax` (Task 3), `<Starfield>` (Task 4).
- Produces: the enriched splash. No new props; `onContinue` unchanged.

Decision (recorded): parallax drives only the new **glow** and **starfield** layers (both use `transform`). The existing `.splash::before` keeps its Ken Burns `transform` animation untouched — layering parallax onto the same `transform` would fight the keyframes, so we add depth with the new layers instead. This honors the spec's "pointer-parallax glow layer + subtle background drift" without re-plumbing Ken Burns.

- [ ] **Step 1: Rewrite `Splash.tsx`**

Replace `components/Splash.tsx` with:

```tsx
'use client';
import { useRef } from 'react';
import { useParallax } from '@/lib/ui/useParallax';
import { Starfield } from '@/components/ui/Starfield';

// Brand splash — the first screen a signed-out visitor sees, before sign-in.
// `onContinue` advances to the sign-in screen (click anywhere or "Let's go").
export function Splash({ onContinue }: { onContinue: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useParallax(rootRef);
  const sub = "Let's learn how to run your company with AI.";

  return (
    <div className="splash" ref={rootRef} onClick={onContinue}>
      <div className="splash-glow" aria-hidden />
      <Starfield />
      <div className="splash-in">
        <h1 className="splash-title pixel">Codepet</h1>
        <p className="splash-sub">
          {sub.split(' ').map((w, i) => (
            <span className="w" key={i} style={{ ['--i' as string]: i }}>
              {w}
              {i < sub.split(' ').length - 1 ? ' ' : ''}
            </span>
          ))}
        </p>
        <button
          className="splash-btn"
          onClick={(e) => {
            e.stopPropagation();
            onContinue();
          }}
        >
          Let&apos;s go
        </button>
      </div>
      <div className="splash-hint">click anywhere to continue</div>
    </div>
  );
}
```

- [ ] **Step 2: Add the glow layer + title sweep + word-rise CSS**

In `app/globals.css`, immediately after the `.splash::after` rule (~line 3154, before `.splash.hide`), add:

```css
/* pointer-parallax glow — a pre-blurred radial gradient, NOT a runtime blur */
.splash-glow {
  position: absolute;
  inset: -12%;
  z-index: 1;
  pointer-events: none;
  background: radial-gradient(38% 38% at 50% 44%, rgba(150, 100, 245, 0.3), transparent 70%);
  transform: translate3d(calc(var(--px, 0) * 10px), calc(var(--py, 0) * 10px), 0);
  will-change: transform;
}
```

Then, after the `.splash-hint` animation rule (~line 3225), add the title-sweep and word-rise rules:

```css
/* slow light-sweep across the wordmark */
.splash-title {
  position: relative;
  overflow: hidden;
}
.splash-title::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(105deg, transparent 42%, rgba(255, 255, 255, 0.55) 50%, transparent 58%);
  mix-blend-mode: overlay;
  transform: translateX(-120%);
  animation: titleSweep 4.6s ease-in-out 1.7s infinite;
  pointer-events: none;
}
@keyframes titleSweep {
  0% {
    transform: translateX(-120%);
  }
  55%,
  100% {
    transform: translateX(120%);
  }
}
/* word-by-word rise on the subtitle (replaces the single-block riseIn) */
.splash-sub .w {
  display: inline-block;
  animation: riseIn 0.7s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  animation-delay: calc(0.32s + var(--i) * 0.06s);
}
```

Update the existing `.splash-sub` animation rule (~line 3215) so the block no longer animates as a whole (the words animate instead) — replace:

```css
.splash-sub {
  animation: riseIn 0.9s cubic-bezier(0.2, 0.7, 0.2, 1) 0.32s both;
}
```

with:

```css
.splash-sub {
  animation: none;
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 4: Manual verification (deferred to the PR preview)**

_Not runnable in this worktree (`next build` rejects the symlinked `node_modules`; `next dev` misreports first-run). Record as a checklist item for the Vercel PR preview:_ splash shows drifting starfield + a glow that follows the pointer, a periodic light-sweep across "Codepet", and the subtitle rising word-by-word.

- [ ] **Step 5: Commit**

```bash
git add components/Splash.tsx app/globals.css
git commit -m "feat(splash): parallax glow + starfield + title sweep + word-by-word subtitle"
```

---

### Task 6: Cinematic onboarding (cold-open + art panel)

**Files:**
- Modify: `components/Onboarding.tsx`
- Modify: `app/globals.css` (cold-open glow; layered crossfade `.ob-art`; per-step color-grade)

**Interfaces:**
- Consumes: `useParallax` (Task 3), `<Starfield>` (Task 4), `STEP_ART` already `.webp` (Task 2).
- Produces: enriched cold-open + a crossfading, slow-zooming, colour-graded art panel. No change to the wizard's steps, data, or validation.

_Spec note — staggered reveal:_ the spec's "staggered reveal" of the right-panel question elements is **already** provided by the existing `.ob-body > *` / `> h2` / `> p` / `:nth-child(n+3)` riseIn stagger (`app/globals.css:6986`, re-keyed per step). No new work — do not duplicate it.

- [ ] **Step 1: Wire parallax + starfield + glow into the cold-open**

In `components/Onboarding.tsx`:

Add imports at the top (after the existing imports):

```tsx
import { useParallax } from '@/lib/ui/useParallax';
import { Starfield } from '@/components/ui/Starfield';
```

Add a color-grade table beside `STEP_ART` (after the `STEP_ART` array):

```tsx
// Per-step colour grade laid over the art panel (soft-light) — one hue per scene.
const STEP_GRADE = [
  'rgba(124,58,237,0.28)', // 0
  'rgba(255,157,107,0.24)', // 1
  'rgba(110,168,255,0.24)', // 2
  'rgba(79,224,207,0.24)', // 3
  'rgba(208,140,245,0.26)', // 4
  'rgba(242,201,76,0.22)', // 5
  'rgba(126,168,255,0.26)', // 6
  'rgba(124,58,237,0.26)', // 7
];
```

Inside `export function Onboarding()`, after the existing `nameRef` declaration (~line 154), add:

```tsx
  const coldRef = useRef<HTMLDivElement>(null);
  useParallax(coldRef);
```

In the `step === 0` return, add `ref={coldRef}` to the root and a glow + starfield as the first children:

```tsx
    return (
      <div className="ob ob-cold" ref={coldRef}>
        <div className="ob-cold-glow" aria-hidden />
        <Starfield />
        <button className="skip-pre" onClick={enterApp}>
          Skip onboarding →
        </button>
        {/* …existing .ob-cold-in unchanged… */}
```

- [ ] **Step 2: Convert the art panel to layered crossfade**

In `components/Onboarding.tsx`, replace the `.ob-art` block in the final return (currently `<div className="ob-art"><span key={step} style={…} /></div>`, ~line 550) with a layered stack + per-step grade var:

```tsx
        <div className="ob-art" style={{ ['--grade' as string]: STEP_GRADE[step] }}>
          {STEP_ART.map((src, i) => (
            <span
              key={i}
              className={i === step ? 'on' : ''}
              style={{ backgroundImage: `url(${src})` }}
            />
          ))}
        </div>
```

- [ ] **Step 3: Add cold-open glow + rewrite `.ob-art` CSS**

In `app/globals.css`, after the `.ob-cold::before` rule (~line 3346), add the cold-open glow:

```css
/* cold-open pointer-parallax glow (pre-blurred gradient, not a runtime blur) */
.ob-cold-glow {
  position: absolute;
  inset: -12%;
  z-index: 1;
  pointer-events: none;
  background: radial-gradient(34% 40% at 24% 46%, rgba(124, 58, 237, 0.26), transparent 70%);
  transform: translate3d(calc(var(--px, 0) * 9px), calc(var(--py, 0) * 9px), 0);
  will-change: transform;
}
```

Replace the existing `.ob-art` + `.ob-art span` + `@keyframes obArtIn` block (~lines 3565–3588) with the layered crossfade:

```css
.ob-art {
  position: relative;
  width: 42%;
  flex: none;
  overflow: hidden;
  background-color: #100a26;
}
/* every scene is a stacked layer; only .on is visible — opacity crossfade + slow zoom */
.ob-art span {
  position: absolute;
  inset: 0;
  background-color: #100a26;
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
  opacity: 0;
  transform: scale(1.07) translate3d(calc(var(--px, 0) * -8px), calc(var(--py, 0) * -8px), 0);
  transition:
    opacity 1.1s ease,
    transform 7s ease;
  will-change: opacity, transform;
}
.ob-art span.on {
  opacity: 1;
  transform: scale(1) translate3d(calc(var(--px, 0) * -8px), calc(var(--py, 0) * -8px), 0);
}
/* per-step colour grade */
.ob-art::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  background: linear-gradient(180deg, transparent 30%, var(--grade, transparent));
  mix-blend-mode: soft-light;
  transition: background 0.8s ease;
}
```

(The two-panel `.obcard` layout drives `.ob-art` on the question steps; adding `position: relative` + `overflow: hidden` keeps the stacked layers clipped to the panel. `useParallax` is only active on the cold-open root — on the question steps `--px/--py` default to 0, so the drift terms are inert there.)

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Manual verification (deferred to the PR preview)**

_Checklist for the Vercel PR preview:_ cold-open shows starfield + pointer-following glow; stepping through 1→7 crossfades the art with a slow zoom and a hue shift per step; the wizard's inputs/validation are unchanged.

- [ ] **Step 6: Commit**

```bash
git add components/Onboarding.tsx app/globals.css
git commit -m "feat(onboarding): cinematic cold-open (parallax/starfield/glow) + crossfading colour-graded art panel"
```

---

### Task 7: In-app department image reveal

**Files:**
- Modify: `app/globals.css` (`.dr-img`, `.dhero2` — load reveal + hover shine)

**Interfaces:**
- Consumes: the swapped cover refs from Task 2.
- Produces: a CSS-only "materialize" mount animation + hover shine sweep. No JS, no parallax, no runtime blur.

- [ ] **Step 1: Add the reveal + shine CSS**

In `app/globals.css`, extend the `.dr-img` rule (~line 2052) — add `overflow: hidden;` and a mount animation — then add the shine pseudo-element. Change the rule to:

```css
.dr-img {
  flex: 0 0 40%;
  position: relative;
  overflow: hidden;
  background-size: cover;
  background-position: center;
  animation: mediaIn 0.6s ease both;
}
/* hover shine sweep */
.dr-img::before,
.dhero2::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  background: linear-gradient(105deg, transparent 45%, rgba(255, 255, 255, 0.18) 50%, transparent 55%);
  transform: translateX(-120%);
  opacity: 0;
}
.deptrow:hover .dr-img::before,
.dhero2:hover::before {
  animation: shine 0.9s ease;
}
@keyframes mediaIn {
  from {
    opacity: 0;
    transform: scale(1.03);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
@keyframes shine {
  from {
    transform: translateX(-120%);
    opacity: 1;
  }
  to {
    transform: translateX(120%);
    opacity: 1;
  }
}
```

Then extend the `.dhero2` rule (~line 1713) — add `overflow: hidden;` (if not present) and the mount animation:

```css
  overflow: hidden;
  animation: mediaIn 0.6s ease both;
```

(Add these two declarations inside the existing `.dhero2 { … }` block; keep everything else it already sets.)

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 3: Manual verification (deferred to the PR preview)**

_Checklist:_ department cover images fade+scale in on load; hovering a company-list row and the department hero sweeps a subtle shine. No layout jank from `content-visibility` (Task 2) on scroll.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css
git commit -m "feat(company): department covers materialize on load + shine on hover (CSS only)"
```

---

### Task 8: Guardrails consolidation + final gates

**Files:**
- Modify: `app/globals.css` (new `@media (max-width: 820px)` intro block; extend `@media (prefers-reduced-motion: reduce)` at ~line 7276)

**Interfaces:**
- Consumes: every new selector added in Tasks 4–7 (`.splash-glow`, `.starfield`, `.splash-title::after`, `.ob-cold-glow`, `.ob-art span`, `.dr-img::before`, `.dhero2::before`, and the `mediaIn`/`shine`/`titleSweep`/`twinkle` animations).
- Produces: both guardrails covering every new layer. This is the single place the cross-cutting media rules live, so they can be verified against the full selector list at once.

- [ ] **Step 1: Add the mobile-lite intro block**

In `app/globals.css`, directly after the `/* ===== splash & onboarding motion ===== */` section's last rule (after the Task-4 `twinkle` keyframes, ~line 6997), add:

```css
/* mobile-lite: strip parallax / particles / sweeps from the intro (max-width:820px).
   Starfield already returns null here; these hide the CSS-only heavy layers. */
@media (max-width: 820px) {
  .splash-glow,
  .ob-cold-glow,
  .starfield,
  .splash-title::after,
  .dr-img::before,
  .dhero2::before {
    display: none !important;
  }
  .ob-art span {
    transition: opacity 0.5s ease;
    transform: none;
  }
  .ob-art span.on {
    transform: none;
  }
  .splash-sub .w {
    animation-delay: 0.32s;
  }
}
```

- [ ] **Step 2: Extend the reduced-motion block**

In the existing `@media (prefers-reduced-motion: reduce)` block (~line 7276), add the new selectors to the group so they collapse to static. Replace the selector list so it reads:

```css
@media (prefers-reduced-motion: reduce) {
  .signin,
  .signin::before,
  .signin-card,
  .splash,
  .splash::before,
  .splash-glow,
  .splash-title,
  .splash-title::after,
  .splash-sub,
  .splash-sub .w,
  .splash-btn,
  .splash-hint,
  .starfield,
  .starfield i,
  .ob-cold,
  .ob-cold::after,
  .ob-cold-glow,
  .ob-cold-in > *,
  .ob-art span,
  .ob-body > *,
  .dr-img,
  .dhero2,
  .dr-img::before,
  .dhero2::before {
    animation: none !important;
    translate: none !important;
    transform: none !important;
    opacity: 1 !important;
    transition: none !important;
  }
}
```

- [ ] **Step 3: Full gate — typecheck, lint, format, tests**

Run: `npm run typecheck && npm run lint && npm run format:check && npm run test && node --test scripts/optimize-images.test.mjs`
Expected: typecheck/lint/format PASS; Vitest green (includes `useParallax.test.ts`); `node --test` green (3 tests). If `format:check` flags the touched files, run `npm run format` and re-commit.

_Baseline note:_ `firestore.rules.test.ts` shows 2 pre-existing `tsc` errors from a missing `@firebase/rules-unit-testing` dev dep — environmental, present on `origin/main`, unrelated to this branch. Do not attempt to fix it here; confirm the count is unchanged (still exactly those 2) rather than newly introduced.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css
git commit -m "feat(intro): mobile-lite + reduced-motion guardrails cover every cinematic layer"
```

- [ ] **Step 5: Push + open the PR; verify on the Vercel preview**

```bash
git push -u origin feat/cinematic-intro
gh pr create --title "Cinematic intro + fast, alive images" --body "<summary>"
```

Then run the spec's manual verification on the **Vercel PR preview** (not `next dev`): fast first paint; splash + cold-open parallax/particles/sweep; onboarding step crossfades + colour grade; dept covers materialize + hover shine; Network panel shows ~5 MB of images, not ~40; mobile viewport drops to the static path; `prefers-reduced-motion` disables motion.

---

## Notes for the executor

- **Worktree build limits:** `next build` fails here (Turbopack rejects the symlinked `node_modules`) and `next dev` misreports first-run (StrictMode double-mount + `resetCompanyData` + HMR). All visual verification happens on the Vercel PR preview. Typecheck / lint / format / unit tests DO run locally and are the per-task gates.
- **Commit ≠ merged ≠ deployed.** This branch reaches prod only after PR merge triggers a Vercel redeploy (prod project `monatruongg-8193s-projects/codepet-v1-2`).
- **Byte-bloom is deferred** (see Global Constraints) — raise it with the user as a follow-up rather than inventing a mascot on the splash/cold-open.
