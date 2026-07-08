'use client';
// The stage ribbon — the journey (Find → Build → Ship → Launch → Run & grow)
// as a light, text-forward breadcrumb pinned at the top of the map. Done phases
// are muted-green, the current one gets a pill (name + progress sliver + %), and
// ahead phases are faint — click any to open its checklist (StageDrawer). When
// the current stage is finished the pill offers "Advance to {next} →". On narrow
// widths (CSS, 640px) done/ahead phases collapse to "N done" / "N ahead" counts.
import { Fragment } from 'react';
import { useApp } from '@/lib/store';
import { ribbonSegments, type RibbonSegment } from '@/lib/overview/ribbon';
import { compactRibbon } from '@/lib/overview/ribbonCompact';
import { currentStageProgress, stageComplete, nextStageOf } from '@/lib/stages';

const SCRIM = 'linear-gradient(180deg, rgba(7,5,16,0.82) 0%, rgba(7,5,16,0) 100%)';

export default function StageRibbon({ highlight = false }: { highlight?: boolean }) {
  const { selectStage, advanceStage, brief, tick } = useApp();
  void tick; // re-render on company mutation (progress + watermark are live reads)
  const segs = ribbonSegments();
  const pct = currentStageProgress().pct;
  const complete = stageComplete();
  const nextStage = nextStageOf(brief.stage);
  const { leadDone, current, trailAhead } = compactRibbon(segs);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 6,
        padding: '10px 16px',
        background: SCRIM,
        pointerEvents: 'none',
        // Glow while the map walkthrough is pointing at the journey strip.
        boxShadow: highlight ? '0 6px 26px rgba(125,227,255,0.4)' : undefined,
        transition: 'box-shadow .25s',
      }}
    >
      {/* Full breadcrumb (default; hidden < 640px by CSS) */}
      <div className="stage-ribbon-full">
        {segs.map((s, i) => (
          <Fragment key={s.name}>
            {i > 0 && <Chevron />}
            <PhaseItem
              seg={s}
              pct={pct}
              complete={complete}
              nextStage={nextStage}
              onOpen={() => selectStage(s.stageN)}
              onAdvance={advanceStage}
            />
          </Fragment>
        ))}
      </div>

      {/* Compact breadcrumb (hidden by default; shown < 640px by CSS) */}
      <div className="stage-ribbon-compact">
        {leadDone && (
          <CountChip
            label={`${leadDone.count} done`}
            tone="done"
            stageN={leadDone.stageN}
            onOpen={selectStage}
          />
        )}
        {leadDone && current && <Chevron />}
        {current && (
          <PhaseItem
            seg={current}
            pct={pct}
            complete={complete}
            nextStage={nextStage}
            onOpen={() => selectStage(current.stageN)}
            onAdvance={advanceStage}
          />
        )}
        {current && trailAhead && <Chevron />}
        {trailAhead && (
          <CountChip
            label={`${trailAhead.count} ahead`}
            tone="ahead"
            stageN={trailAhead.stageN}
            onOpen={selectStage}
          />
        )}
      </div>
    </div>
  );
}

function Chevron() {
  return (
    <span
      aria-hidden
      style={{ color: 'rgba(255,255,255,0.16)', fontSize: 12, pointerEvents: 'none' }}
    >
      ›
    </span>
  );
}

function PhaseItem({
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

  if (current) {
    const canAdvance = complete && !!nextStage;
    return (
      <button
        onClick={canAdvance ? onAdvance : onOpen}
        title={canAdvance ? `Advance to ${nextStage}` : `You are here · ${pct}% through this stage`}
        style={{
          pointerEvents: 'auto',
          cursor: 'pointer',
          fontFamily: 'inherit',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 9,
          padding: '5px 13px',
          borderRadius: 999,
          color: '#F5F3FF',
          background: canAdvance
            ? 'linear-gradient(90deg, rgba(139,92,246,0.28), rgba(52,211,153,0.22))'
            : 'rgba(139,92,246,0.16)',
          border: `1px solid ${canAdvance ? 'rgba(139,92,246,0.55)' : 'rgba(139,92,246,0.4)'}`,
          boxShadow: canAdvance ? '0 0 16px rgba(139,92,246,0.25)' : 'none',
        }}
      >
        {canAdvance ? (
          <>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#F7F5FF' }}>
              Advance to {nextStage}
            </span>
            <span style={{ fontSize: 13, color: '#C9B8FF' }}>→</span>
          </>
        ) : (
          <>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{seg.name}</span>
            <span
              aria-hidden
              style={{
                width: 34,
                height: 4,
                borderRadius: 3,
                background: 'rgba(255,255,255,0.14)',
                position: 'relative',
                overflow: 'hidden',
                display: 'inline-block',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${pct}%`,
                  background: '#C9B8FF',
                }}
              />
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#C9B8FF' }}>{pct}%</span>
          </>
        )}
      </button>
    );
  }

  return (
    <button
      onClick={onOpen}
      title={seg.name}
      style={{
        pointerEvents: 'auto',
        cursor: 'pointer',
        fontFamily: 'inherit',
        background: 'none',
        border: 'none',
        padding: '3px 2px',
        fontSize: 13,
        fontWeight: 600,
        color: done ? 'rgba(52,211,153,0.72)' : 'rgba(245,243,255,0.32)',
      }}
    >
      {seg.name}
    </button>
  );
}

function CountChip({
  label,
  tone,
  stageN,
  onOpen,
}: {
  label: string;
  tone: 'done' | 'ahead';
  stageN: number;
  onOpen: (n: number) => void;
}) {
  return (
    <button
      onClick={() => onOpen(stageN)}
      title={label}
      style={{
        pointerEvents: 'auto',
        cursor: 'pointer',
        fontFamily: 'inherit',
        background: 'none',
        border: 'none',
        padding: '3px 2px',
        fontSize: 12,
        fontWeight: 600,
        color: tone === 'done' ? 'rgba(52,211,153,0.6)' : 'rgba(245,243,255,0.3)',
      }}
    >
      {label}
    </button>
  );
}
