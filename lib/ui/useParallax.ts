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
