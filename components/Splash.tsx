'use client';
import { Fragment, useRef } from 'react';
import { useParallax } from '@/lib/ui/useParallax';
import { Starfield } from '@/components/ui/Starfield';

// Brand splash — the first screen a signed-out visitor sees, before sign-in.
// `onContinue` advances to the sign-in screen (click anywhere or "Let's go").
export function Splash({ onContinue }: { onContinue: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useParallax(rootRef);
  const words = "Let's learn how to run your company with AI.".split(' ');

  return (
    <div className="splash" ref={rootRef} onClick={onContinue}>
      <div className="splash-glow" aria-hidden />
      <Starfield />
      <div className="splash-in">
        <h1 className="splash-title pixel">Codepet</h1>
        <p className="splash-sub">
          {/* Each word rises on its own; the space lives BETWEEN the inline-block
              spans as a real text node — a trailing space inside an inline-block is
              trimmed, which is what ran the words together. */}
          {words.map((w, i) => (
            <Fragment key={i}>
              <span className="w" style={{ ['--i' as string]: i }}>
                {w}
              </span>
              {i < words.length - 1 ? ' ' : ''}
            </Fragment>
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
