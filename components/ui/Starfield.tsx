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
