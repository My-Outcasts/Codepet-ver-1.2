'use client';
// The stage ribbon — the retired Roadmap, compacted onto the map. Five phases
// left→right; the phase you're in is lit with a fill for how far through the
// current stage you are; done phases are filled, future ones faint. Click a
// phase to open its checklist (StageDrawer). When the stage's work is finished,
// the current phase offers to advance. Display sits in the glass-HUD style.
import { useApp } from '@/lib/store';
import { ribbonSegments, type RibbonSegment } from '@/lib/overview/ribbon';
import { currentStageProgress, stageComplete, nextStageOf } from '@/lib/stages';

const CARD_BG = 'rgba(16,14,28,0.72)';
const BORDER = 'rgba(255,255,255,0.09)';

export default function StageRibbon() {
  const { selectStage, advanceStage, brief, tick } = useApp();
  void tick; // re-render on company mutation (progress + watermark are live reads)
  const segs = ribbonSegments();
  const pct = currentStageProgress().pct;
  const complete = stageComplete();
  const nextStage = nextStageOf(brief.stage);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 6,
        display: 'flex',
        gap: 6,
        padding: '10px 16px',
        background: 'linear-gradient(180deg, rgba(7,5,16,0.82) 0%, rgba(7,5,16,0) 100%)',
        pointerEvents: 'none',
      }}
    >
      {segs.map((s) => (
        <Segment
          key={s.name}
          seg={s}
          pct={pct}
          complete={complete && s.state === 'current'}
          nextStage={nextStage}
          onOpen={() => selectStage(s.stageN)}
          onAdvance={advanceStage}
        />
      ))}
    </div>
  );
}

function Segment({
  seg,
  pct,
  complete,
  nextStage,
  onOpen,
  onAdvance,
}: {
  seg: RibbonSegment;
  pct: number;
  complete: boolean;
  nextStage: string | null;
  onOpen: () => void;
  onAdvance: () => void;
}) {
  const current = seg.state === 'current';
  const done = seg.state === 'done';
  const fill = current ? pct : done ? 100 : 0;
  const tint = done ? '#34D399' : current ? '#8B5CF6' : 'rgba(255,255,255,0.14)';
  const label = complete && nextStage ? `Advance to ${nextStage}` : seg.name;
  return (
    <button
      onClick={complete ? onAdvance : onOpen}
      title={current ? `You are here · ${pct}% through this stage` : seg.name}
      style={{
        flex: 1,
        pointerEvents: 'auto',
        position: 'relative',
        overflow: 'hidden',
        textAlign: 'left',
        fontFamily: 'inherit',
        cursor: 'pointer',
        border: `1px solid ${current ? 'rgba(139,92,246,0.5)' : BORDER}`,
        borderRadius: 9,
        background: CARD_BG,
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        padding: '7px 11px',
        color: current ? '#F5F3FF' : done ? 'rgba(245,243,255,.72)' : 'rgba(245,243,255,.4)',
      }}
    >
      {/* progress fill — a translucent wash up to pct%, plus a solid accent bar */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${fill}%`,
          background: current
            ? 'rgba(139,92,246,0.18)'
            : done
              ? 'rgba(52,211,153,0.13)'
              : 'transparent',
          transition: 'width .3s ease',
        }}
      />
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          height: 3,
          width: `${fill}%`,
          background: tint,
          transition: 'width .3s ease',
        }}
      />
      <span
        style={{
          position: 'relative',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 6,
        }}
      >
        <span
          style={{
            fontSize: 9,
            letterSpacing: '1px',
            fontWeight: 700,
            textTransform: 'uppercase',
            opacity: current ? 0.7 : 0.4,
          }}
        >
          {current ? 'You are here' : done ? 'Done' : 'Ahead'}
        </span>
        {current && <span style={{ fontSize: 11, fontWeight: 700, color: '#C9B8FF' }}>{pct}%</span>}
      </span>
      <span
        style={{
          position: 'relative',
          display: 'block',
          fontSize: 12.5,
          fontWeight: 600,
          letterSpacing: '-.2px',
          marginTop: 2,
        }}
      >
        {label}
      </span>
    </button>
  );
}
