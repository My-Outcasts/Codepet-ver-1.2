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
              {i < sub.split(' ').length - 1 ? ' ' : ''}
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
