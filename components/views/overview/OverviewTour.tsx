'use client';
// The step-by-step map walkthrough card. A fixed caption at the bottom of the Overview:
// while it's up, OverviewView flies the camera to the step's element and dims the rest, so
// this card just names what's now lit and moves the founder along. Pure content + intent
// (onNext / onSkip); the step model and copy live in lib/overviewTour.ts.
import { GUIDE_HEX } from '@/lib/overviewIntro';
import { fillTourBody, isLastStep, type TourStep } from '@/lib/overviewTour';

export default function OverviewTour({
  step,
  index,
  total,
  dept,
  stage,
  onNext,
  onSkip,
}: {
  step: TourStep;
  index: number;
  total: number;
  dept?: string;
  stage?: string;
  onNext: () => void;
  onSkip: () => void;
}) {
  const last = isLastStep(index, total);
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 92,
        transform: 'translateX(-50%)',
        zIndex: 9,
        width: 440,
        maxWidth: '92vw',
        pointerEvents: 'auto',
        padding: '16px 18px 15px',
        background: 'rgba(16,14,28,0.97)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: `1px solid ${GUIDE_HEX}40`,
        borderRadius: 16,
        boxShadow: '0 18px 50px rgba(0,0,0,0.6)',
      }}
    >
      {/* kicker + progress dots */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          style={{
            fontSize: 10,
            letterSpacing: '1.5px',
            fontWeight: 700,
            color: GUIDE_HEX,
            textTransform: 'uppercase',
          }}
        >
          byte · guide
        </span>
        <span
          style={{ display: 'inline-flex', gap: 5 }}
          aria-label={`Step ${index + 1} of ${total}`}
        >
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: i === index ? GUIDE_HEX : 'rgba(245,243,255,.22)',
              }}
            />
          ))}
        </span>
      </div>

      <div
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: '#F5F3FF',
          letterSpacing: '-.2px',
          marginTop: 9,
        }}
      >
        {step.title}
      </div>
      <p
        style={{
          margin: '5px 0 0',
          fontSize: 13.5,
          lineHeight: 1.5,
          color: 'rgba(245,243,255,.72)',
        }}
      >
        {fillTourBody(step.body, { dept, stage })}
      </p>

      {step.legend && step.legend.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px 14px', marginTop: 10 }}>
          {step.legend.map((l) => (
            <span
              key={l.label}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                fontSize: 12,
                color: 'rgba(245,243,255,.8)',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: l.hex,
                  flex: 'none',
                }}
              />
              {l.label}
            </span>
          ))}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 15,
        }}
      >
        <button
          type="button"
          onClick={onSkip}
          style={{
            fontFamily: 'inherit',
            fontSize: 12.5,
            color: 'rgba(245,243,255,.5)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          {last ? 'Close' : 'Skip tour'}
        </button>
        <button
          type="button"
          onClick={onNext}
          style={{
            fontFamily: 'inherit',
            fontSize: 13,
            fontWeight: 700,
            color: '#04030A',
            background: GUIDE_HEX,
            border: 'none',
            borderRadius: 9,
            padding: '8px 16px',
            cursor: 'pointer',
          }}
        >
          {step.cta}
          {!last && ' ›'}
        </button>
      </div>
    </div>
  );
}
