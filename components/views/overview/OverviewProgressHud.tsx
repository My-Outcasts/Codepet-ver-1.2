'use client';
// The Overview's overall progress hero — a small persistent HUD at the map's
// bottom-left (just above the color legend): how far along the whole active plan is,
// plus the next milestone. Bottom-left keeps it clear of the top-left title/subtitle/
// example-plan/advance cluster. Presentational; OverviewView computes the numbers and
// keeps it live.
import type { OverviewProgress } from '@/lib/overview/progress';

const CYAN = '#7DE3FF';

export default function OverviewProgressHud({
  progress,
  nextStage,
}: {
  progress: OverviewProgress;
  nextStage: string | null;
}) {
  const { pct, done, total, areasDone, areasTotal } = progress;
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 52,
        left: 26,
        zIndex: 5,
        width: 210,
        padding: '10px 12px',
        background: 'rgba(16,14,28,0.82)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: '1px solid rgba(125,227,255,0.22)',
        borderRadius: 11,
        pointerEvents: 'none',
        fontFamily: 'inherit',
      }}
    >
      <div
        style={{
          fontSize: 9,
          letterSpacing: '0.9px',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: CYAN,
        }}
      >
        Building your company
      </div>
      <div
        style={{
          marginTop: 7,
          height: 5,
          borderRadius: 3,
          background: 'rgba(255,255,255,0.12)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: CYAN,
            transition: 'width .4s ease',
          }}
        />
      </div>
      <div style={{ marginTop: 7, display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#F5F3FF' }}>{pct}%</span>
        <span style={{ fontSize: 10.5, color: 'rgba(245,243,255,0.6)' }}>
          {done}/{total} moves · {areasDone} of {areasTotal} areas
        </span>
      </div>
      <div style={{ marginTop: 4, fontSize: 10, color: 'rgba(245,243,255,0.45)' }}>
        {nextStage ? `Next: ${nextStage} →` : 'Final stage'}
      </div>
    </div>
  );
}
