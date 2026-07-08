'use client';
// The Overview tab, wrapped with a Roadmap ⁄ Map sub-tab. The roadmap (the redesign's hero)
// is the default; the existing 3D force-graph lives behind the "Map" toggle and is still
// lazy-loaded (three.js is only fetched when you actually open it). This wrapper is
// deliberately thin and leaves OverviewView untouched, so it doesn't conflict with ongoing
// work on that component — the only app-wide change is one line in AppRoot pointing here.
import { useState, type CSSProperties } from 'react';
import dynamic from 'next/dynamic';
import { useApp } from '@/lib/store';
import RoadmapView from './overview/RoadmapView';
import { ROADMAP_TEMPLATE, ROADMAP_PHASES } from '@/lib/overview/roadmapTemplate';
import { applyProgress, stageToPhase } from '@/lib/overview/roadmapProgress';

// The force-graph, client-only + lazy (unchanged from AppRoot's previous dynamic import).
const OverviewMap = dynamic(() => import('./OverviewView'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: '#0c0a17',
        display: 'grid',
        placeItems: 'center',
        color: 'rgba(245,243,255,.5)',
        fontSize: 13,
      }}
    >
      Building your company map…
    </div>
  ),
});

const CY = '#7de3ff';

export default function OverviewSection() {
  const { brief, nextStep, library, tracking } = useApp();
  const [tab, setTab] = useState<'roadmap' | 'map'>('roadmap');

  // Live progress: the founder's onboarding stage picks the current phase; byte's next
  // step (a real dept task) soft-matches a current-phase template task by department to
  // light "byte is here"; the project name goes on the root node.
  const currentPhase = stageToPhase(brief.stage);
  const phaseTasks = ROADMAP_TEMPLATE.filter((t) => t.phase === currentPhase);
  const currentTaskId =
    (nextStep && phaseTasks.find((t) => t.dept === nextStep.deptK)?.id) ||
    phaseTasks[0]?.id ||
    null;
  const tasks = applyProgress(ROADMAP_TEMPLATE, { currentPhase, currentTaskId });
  const projectName = brief.projectName?.trim() || 'Your company';

  return (
    <section
      className="view on"
      style={{
        position: 'absolute',
        inset: 0,
        background: '#05040b',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* sub-tab toggle */}
      <div style={{ flex: 'none', padding: '16px 24px 0' }}>
        <div
          style={{
            display: 'inline-flex',
            gap: 3,
            padding: 4,
            background: '#0d0b18',
            border: '1px solid rgba(245,243,255,0.09)',
            borderRadius: 11,
          }}
        >
          {(['roadmap', 'map'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              style={{
                fontFamily: 'inherit',
                fontSize: 12.5,
                fontWeight: 600,
                textTransform: 'capitalize',
                padding: '6px 14px',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                background: tab === k ? 'rgba(125,227,255,0.13)' : 'transparent',
                color: tab === k ? CY : 'rgba(245,243,255,0.4)',
              }}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      {tab === 'map' ? (
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <OverviewMap />
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* roadmap fills the space and is vertically centered, so there's no empty void */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              overflowX: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              padding: '10px 24px',
            }}
          >
            <RoadmapView tasks={tasks} phases={ROADMAP_PHASES} projectName={projectName} />
          </div>
          <ProofStrip
            shipped={library.length}
            sessions={tracking.sessions}
            commits={tracking.commits}
            hours={tracking.hoursSaved}
          />
        </div>
      )}
    </section>
  );
}

// A deliberately slim reassurance strip — the roadmap is the focus, so shipped count + real
// repo activity ride in one thin row rather than two big cards.
function ProofStrip({
  shipped,
  sessions,
  commits,
  hours,
}: {
  shipped: number;
  sessions: number;
  commits: number;
  hours: number;
}) {
  const b: CSSProperties = {
    color: '#f5f3ff',
    fontWeight: 700,
    fontSize: 14,
    marginRight: 4,
    fontVariantNumeric: 'tabular-nums',
  };
  return (
    <div
      style={{
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap',
        margin: '0 24px 20px',
        padding: '10px 16px',
        background: '#151222',
        border: '1px solid rgba(245,243,255,0.09)',
        borderRadius: 12,
        fontSize: 12.5,
        color: 'rgba(245,243,255,0.64)',
      }}
    >
      <span>
        <b style={b}>{shipped}</b>shipped
      </span>
      <span style={{ width: 1, height: 15, background: 'rgba(245,243,255,0.16)' }} />
      <span>
        <b style={b}>{sessions}</b>sessions
      </span>
      <span>
        <b style={b}>{commits}</b>commits
      </span>
      <span>
        <b style={b}>~{hours}h</b>saved
      </span>
      <span
        style={{
          marginLeft: 'auto',
          fontFamily: 'ui-monospace, monospace',
          fontSize: 10.5,
          color: 'rgba(245,243,255,0.4)',
        }}
      >
        byte’s real work in your repos
      </span>
    </div>
  );
}
