'use client';
// The Overview tab, wrapped with a Roadmap ⁄ Map sub-tab. The roadmap (the redesign's hero)
// is the default; the existing 3D force-graph lives behind the "Map" toggle and is still
// lazy-loaded (three.js is only fetched when you actually open it). This wrapper is
// deliberately thin and leaves OverviewView untouched, so it doesn't conflict with ongoing
// work on that component — the only app-wide change is one line in AppRoot pointing here.
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useApp } from '@/lib/store';
import { DEPTS } from '@/lib/data';
import { nextAction } from '@/lib/roadmap';
import { overviewProgress } from '@/lib/overview/progress';
import RoadmapView from './overview/RoadmapView';
import { ROADMAP_TEMPLATE, ROADMAP_PHASES } from '@/lib/overview/roadmapTemplate';
import { applyProgress, stageToPhase } from '@/lib/overview/roadmapProgress';
import type { RoadmapTask } from '@/lib/overview/roadmapModel';

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
  const { brief, nextStep, library, tracking, tick, openDept, portalToTask } = useApp();
  const [tab, setTab] = useState<'roadmap' | 'map'>('roadmap');
  void tick; // re-read the live DEPTS (progress + load) after a task mutation

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

  // byte's real next move — the actionable one. Prefer /api/next-step; fall back to the
  // authored golden path so Start always resolves to a REAL department task.
  const fallback = nextAction();
  const move = nextStep
    ? { deptK: nextStep.deptK, title: nextStep.taskTitle }
    : fallback
      ? { deptK: fallback.dept.k, title: fallback.task.t }
      : null;
  const startMove = () => {
    if (move) portalToTask(move.deptK, move.title);
  };

  // Real overall progress + what's on the founder's plate (from live DEPTS, not the template).
  const prog = overviewProgress(DEPTS);
  let needsYou = 0;
  let approve = 0;
  for (const d of DEPTS) {
    for (const t of d.tasks) {
      if (t.done) continue;
      if (t.drafted) approve += 1;
      else if (t.who === 'you') needsYou += 1;
    }
  }

  // Click a card: the current move starts byte on the real task; any other card opens its
  // real department so the founder can act on the actual work there.
  const onTaskClick = (task: RoadmapTask) => {
    if (task.state === 'current') startMove();
    else openDept(task.dept);
  };

  const toggle = (
    <div
      style={{
        flex: 'none',
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
  );

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
      {tab === 'map' ? (
        <>
          <div style={{ flex: 'none', padding: '16px 24px 0' }}>{toggle}</div>
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <OverviewMap />
          </div>
        </>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Overview heading — the roadmap is the tab's main interface, so it carries the title. */}
          <div
            style={{
              flex: 'none',
              padding: '18px 24px 4px',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 16,
            }}
          >
            <div>
              <h1
                style={{
                  fontSize: 21,
                  fontWeight: 600,
                  color: '#F5F3FF',
                  letterSpacing: '-.3px',
                  margin: 0,
                }}
              >
                Overview
              </h1>
              <div
                style={{
                  fontSize: 13,
                  color: 'rgba(245,243,255,.55)',
                  marginTop: 3,
                  maxWidth: '62ch',
                }}
              >
                Your whole company as a roadmap — where you are, what byte does next, and how far
                you’ve come.
              </div>
              {/* real momentum + what's on your plate, from live DEPTS */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  marginTop: 11,
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: 11.5,
                  color: 'rgba(245,243,255,0.5)',
                }}
              >
                <span style={{ color: '#f5f3ff', fontWeight: 700 }}>{prog.pct}%</span>
                <span
                  style={{
                    width: 72,
                    height: 5,
                    borderRadius: 3,
                    background: 'rgba(245,243,255,0.1)',
                    overflow: 'hidden',
                  }}
                >
                  <span
                    style={{
                      display: 'block',
                      height: '100%',
                      width: `${prog.pct}%`,
                      background: CY,
                    }}
                  />
                </span>
                <span>
                  {prog.done}/{prog.total} moves
                </span>
                {needsYou > 0 && <span style={{ color: '#3b82f6' }}>needs you {needsYou}</span>}
                {approve > 0 && <span style={{ color: '#fdb022' }}>approve {approve}</span>}
              </div>
            </div>
            {toggle}
          </div>

          {/* the single actionable next move — Start runs byte on the real task */}
          {move && (
            <div
              style={{
                flex: 'none',
                margin: '4px 24px 0',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 12px 10px 15px',
                borderRadius: 12,
                background:
                  'linear-gradient(180deg, rgba(125,227,255,0.10), rgba(125,227,255,0.02))',
                border: '1px solid rgba(125,227,255,0.4)',
              }}
            >
              <span
                style={{
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: 10,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: CY,
                  flex: 'none',
                }}
              >
                byte · do this next
              </span>
              <span
                style={{
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: '#f5f3ff',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {move.title}
              </span>
              <button
                type="button"
                onClick={startMove}
                style={{
                  marginLeft: 'auto',
                  flex: 'none',
                  fontFamily: 'inherit',
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: '#04030a',
                  background: CY,
                  border: 'none',
                  borderRadius: 9,
                  padding: '7px 16px',
                  cursor: 'pointer',
                }}
              >
                Start →
              </button>
            </div>
          )}
          {/* roadmap fills the space and is vertically centered, so there's no empty void */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              overflowX: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              padding: '6px 24px',
            }}
          >
            <RoadmapView
              tasks={tasks}
              phases={ROADMAP_PHASES}
              projectName={projectName}
              onTaskClick={onTaskClick}
            />
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

// Progress at a glance — a row of colourful glowing stat cards. One accent per metric, a
// soft corner glow, a big number. Compact (one row, so the roadmap stays the hero) but
// vivid. Shipped is byte's approved deliverables; the rest is real Claude Code activity.
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
  const stats: { accent: string; value: string; label: string }[] = [
    { accent: '#7de3ff', value: String(shipped), label: 'shipped' },
    { accent: '#8b5cf6', value: String(sessions), label: 'sessions' },
    { accent: '#34d399', value: String(commits), label: 'commits' },
    { accent: '#fdb022', value: `~${hours}h`, label: 'saved' },
  ];
  return (
    <div
      style={{
        flex: 'none',
        display: 'flex',
        gap: 12,
        margin: '2px 24px 20px',
      }}
    >
      {stats.map((s) => (
        <StatCard key={s.label} accent={s.accent} value={s.value} label={s.label} />
      ))}
    </div>
  );
}

function StatCard({ accent, value, label }: { accent: string; value: string; label: string }) {
  return (
    <div
      style={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 16,
        padding: '14px 18px 15px',
        // frosted glass: translucent gradient + blur + light rim + inner top highlight
        background:
          'linear-gradient(145deg, rgba(255,255,255,0.10), rgba(255,255,255,0.035) 55%, rgba(255,255,255,0.015))',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.12)',
        boxShadow: '0 10px 34px -14px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.18)',
      }}
    >
      {/* a soft accent sheen catching the top corner of the glass */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: -32,
          right: -22,
          width: 92,
          height: 92,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${accent}33, transparent 68%)`,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'relative',
          fontSize: 27,
          fontWeight: 750,
          color: '#f5f3ff',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
          letterSpacing: '-0.02em',
        }}
      >
        {value}
      </div>
      <div
        style={{
          position: 'relative',
          marginTop: 8,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: 'ui-monospace, monospace',
          fontSize: 10.5,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'rgba(245,243,255,0.6)',
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: accent,
            boxShadow: `0 0 8px ${accent}`,
          }}
        />
        {label}
      </div>
    </div>
  );
}
