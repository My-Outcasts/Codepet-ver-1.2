# Cinematic intro + fast, alive images

**Date:** 2026-07-03
**Branch:** `feat/cinematic-intro` (off `origin/main`)
**Status:** approved design

## Problem

The splash and onboarding are the first thing a new founder sees, but they lean on a
single Ken Burns pan. The founder asked for a more engaging, cinematic first-run, faster
image loading, and more visual life in the images. Two concrete issues:

1. **Weight:** ~40 MB of raw images ship un-optimized — `public/covers/*.png` alone is
   **33 MB** (8 AI-art PNGs, 2.7–5.9 MB each), plus `public/onboarding/*.jpg` (5.3 MB) and
   splash/loading/auth JPGs (~2.2 MB). Nothing uses `next/image`; every image is a CSS
   `background-image` referenced by URL.
2. **Motion:** the intro has a small effect vocabulary (Ken Burns, fadeIn, riseIn) and
   feels flat relative to the product's cinematic-dark + magical art direction.

## Direction (decided)

- **Cinematic & dreamy** motion language (matches the site art direction).
- **Heavy effects on the intro only** (splash + onboarding). In-app department images get
  the load-speed win + a *light* reveal — not full parallax — to honor the minimalist
  in-app north-star and avoid heavy motion on the scrolling company list.
- **Replace** the giant PNGs with WebP (drop the PNGs) — the point is to shrink served
  weight, not carry both.

## Non-goals

- No `next/image` migration: the images are CSS backgrounds, where `next/image` doesn't
  apply. Optimization is done by re-encoding the source assets + `image-set()`.
- No new heavy motion on in-app scrolling views beyond a light load reveal + hover shine.
- No change to onboarding *logic* / wizard flow — this is presentation only.
- Nothing in Giang's Build Coach surface. Splash/Onboarding/CompanyView are all ours.

## Global constraints

- **GPU-safe motion only:** animate `transform` / `opacity` / `scale`. **Never** animate
  `filter: blur()` on an image at high radius — that is exactly what tanked the nebula
  (~1.2 s/frame on iPhone). All "glow" is a pre-blurred radial-gradient layer, not runtime
  blur of an image.
- **`@media (max-width: 820px)` mobile-lite:** strip parallax, particles, and filters —
  static image + simple fade (mirrors the existing mobile-lite block).
- **`@media (prefers-reduced-motion: reduce)`:** disable Ken Burns, parallax, particles,
  and sweeps; keep instant static states.
- Keep the existing minimalist aesthetic — richer, not gaudy.

## Components

### 1. Image pipeline (load speed) — all images

- `scripts/optimize-images.mjs` (Node, uses **sharp** 0.34.5, already installed): converts
  `public/covers/*.png`, `public/onboarding/*.jpg`, and `public/{splash,loading,auth}.jpg`
  to **WebP** (and **AVIF** for the covers, which dominate weight). Quality targets:
  WebP q80, AVIF q50; cap the longest edge at the size actually rendered (covers render at
  card/hero size — target ~1600px longest edge). Writes siblings (`eng.webp`, `eng.avif`),
  leaves originals for the same commit to delete.
- Update the ~4 render sites (`CompanyView.tsx` `dr-img`, `DepartmentDetail.tsx` `dhero2`,
  `Onboarding.tsx` `STEP_ART` + `.ob-art`, and the CSS `url(...)` for splash/loading/auth/
  ob-cold) to the new format. For CSS backgrounds, prefer `image-set()` with an AVIF source
  and a WebP fallback where both exist; otherwise a plain WebP `url()`.
- **Delete** the original PNGs (covers) and large JPGs from `public/` once references move.
- **Preload** the first splash/cold-open image via a `<link rel="preload" as="image">` in
  the document head (so first paint is instant), and add `content-visibility: auto` +
  `contain-intrinsic-size` to the dept rows so off-screen covers cost nothing to lay out.

Expected: ~40 MB → ~5 MB of served image weight.

### 2. Reusable motion units

- **`useParallax(ref)` hook** (`lib/ui/useParallax.ts`): on pointer move within `ref`, write
  normalized `--px` / `--py` (−1..1) CSS custom properties (throttled via rAF). No-ops when
  `prefers-reduced-motion` or on touch/coarse pointers. Consumed by splash + cold-open to
  drift background/glow layers a few px for depth.
- **`<Starfield>` component** (`components/ui/Starfield.tsx`): a lightweight drifting particle
  layer (CSS-animated dots via a small generated set, or a single lightweight canvas).
  Renders `null` under mobile-lite / reduced-motion (gated by a `matchMedia` check). Used by
  splash + cold-open.

### 3. Cinematic splash (`components/Splash.tsx` + CSS)

Over the existing Ken Burns background: a pointer-parallax **glow layer** + subtle background
drift (via `useParallax`), a **`<Starfield>`** particle layer, a slow **light-sweep** across
the "Codepet" title, and a **word-by-word rise** entrance for title/subtitle/button. Byte
gets a soft bloom. All layers collapse to a static gradient + simple fade under the
guardrails.

### 4. Cinematic onboarding (`components/Onboarding.tsx` + CSS)

- **Cold-open (step 0):** reuse `useParallax` + `<Starfield>` + glow over the cold-open hero;
  byte "boots in"; the headline rises word-by-word.
- **Steps 1–7 art panel (`.ob-art`):** upgrade the keyed image swap into a **cinematic
  crossfade + slow zoom** between scenes, a persistent slow parallax drift, and a per-step
  color-grade overlay. The right-panel question elements get a **staggered reveal**.
- No change to the wizard's data flow, steps, or validation.

### 5. In-app department images — light effect (`CompanyView`, `DepartmentDetail` + CSS)

Optimized format + a **fade/scale-in on load** (materialize feel) and a subtle **shine sweep
on hover**. Implemented in CSS (mount animation) so no per-image JS is needed; the load
reveal uses a cheap opacity/scale keyframe on the `.dr-img` / `.dhero2` element. No parallax,
no runtime blur.

## Data flow

```
build/prepare:  scripts/optimize-images.mjs  →  webp/avif siblings in public/
render:         CSS background-image / inline style → image-set(avif, webp)
motion:         pointer move → useParallax → --px/--py CSS vars → transform on glow/bg layers
                <Starfield> → CSS/canvas drift (gated off on mobile/reduced-motion)
guardrails:     @media (max-width:820px) + (prefers-reduced-motion) strip heavy layers
```

## Error handling / robustness

- `optimize-images.mjs` is idempotent (skips an output that already exists unless `--force`)
  and fails loudly per-file without aborting the batch.
- If a WebP/AVIF is missing at runtime, `image-set()` falls back to the next candidate; a
  plain `url()` WebP is used where `image-set()` isn't warranted.
- `<Starfield>` and `useParallax` degrade to no-ops (render `null` / skip listeners) rather
  than erroring when `matchMedia`/pointer APIs are unavailable (SSR-safe: guard `window`).

## Testing

- **Unit:** `optimize-images.mjs` helpers (target size/quality selection, output path
  derivation) tested in isolation; `useParallax`'s pure clamp/normalize helper tested.
- **Manual on the Vercel PR preview** (not `next dev`): first paint is fast; splash +
  onboarding show parallax/particles/sweeps; step transitions crossfade; dept images
  materialize on load. Then throttle to a mobile viewport and confirm the mobile-lite path
  (no parallax/particles, static + fade), and toggle `prefers-reduced-motion` and confirm
  motion is disabled. Sanity-check served image weight in the Network panel (~5 MB, not 40).

## Ship

Built in an isolated worktree off `origin/main`; verify on the Vercel PR preview; PR → merge
so it reaches prod (committed ≠ merged ≠ deployed).
