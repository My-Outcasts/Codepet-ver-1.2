'use client';
// The Overview tab, wrapped with a Roadmap ⁄ Map sub-tab. The roadmap (the redesign's hero)
// is the default; the existing 3D force-graph lives behind the "Map" toggle and is still
// lazy-loaded (three.js is only fetched when you actually open it). This wrapper is
// deliberately thin and leaves OverviewView untouched, so it doesn't conflict with ongoing
// work on that component — the only app-wide change is one line in AppRoot pointing here.
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useApp } from '@/lib/store';
import { DEPTS } from '@/lib/data';
import { nextAction } from '@/lib/roadmap';
import { generateRoadmap, loadSavedRoadmap } from '@/lib/ai/generateRoadmap';
import RoadmapView from './overview/RoadmapView';
import { ROADMAP_TEMPLATE, ROADMAP_PHASES } from '@/lib/overview/roadmapTemplate';
import { applyProgress, stageToPhase } from '@/lib/overview/roadmapProgress';
import type { RoadmapTask, RoadmapTaskDef } from '@/lib/overview/roadmapModel';

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

const CY = '#7c3aed';

export default function OverviewSection() {
  const { brief, nextStep, library, tracking, tick, openDept, portalToTask } = useApp();
  const [tab, setTab] = useState<'roadmap' | 'map'>('roadmap');
  void tick; // re-read the live DEPTS (progress + load) after a task mutation

  // byte's real, per-company roadmap once generated; until then the canonical template.
  const [genRoadmap, setGenRoadmap] = useState<RoadmapTaskDef[] | null>(null);
  const [generating, setGenerating] = useState(false);
  useEffect(() => {
    let live = true;
    loadSavedRoadmap().then((r) => {
      if (live && r) setGenRoadmap(r);
    });
    return () => {
      live = false;
    };
  }, []);
  const onGenerate = () => {
    setGenerating(true);
    generateRoadmap(brief)
      .then((r) => {
        if (r) setGenRoadmap(r);
      })
      .finally(() => setGenerating(false));
  };
  const defs = genRoadmap ?? ROADMAP_TEMPLATE;

  const currentPhase = stageToPhase(brief.stage);
  const phaseTasks = defs.filter((t) => t.phase === currentPhase);
  const projectName = brief.projectName?.trim() || 'Your company';

  // byte's real next move — the single actionable task. Prefer /api/next-step; fall back to
  // the authored golden path so Start always resolves to a REAL department task.
  const fallback = nextAction();
  const move = nextStep
    ? { deptK: nextStep.deptK, title: nextStep.taskTitle }
    : fallback
      ? { deptK: fallback.dept.k, title: fallback.task.t }
      : null;
  const startMove = () => {
    if (move) portalToTask(move.deptK, move.title);
  };

  // The lit "byte is here" node: take a current-phase slot (prefer one whose department
  // matches the move) and RELABEL it to byte's real next move — so the map agrees with the
  // "do this next" hero and clicking that node runs the very same task.
  const currentTaskId =
    (move && phaseTasks.find((t) => t.dept === move.deptK)?.id) || phaseTasks[0]?.id || null;
  let tasks = applyProgress(defs, { currentPhase, currentTaskId });
  if (move && currentTaskId) {
    tasks = tasks.map((t) =>
      t.id === currentTaskId ? { ...t, title: move.title, dept: move.deptK } : t,
    );
  }

  // Overall progress derives from the roadmap itself (the single source of truth for this
  // view), so the headline % always agrees with the phase columns instead of contradicting
  // them. "needs you / approve" stay from live DEPTS — real, actionable nudges that measure a
  // different thing (work on your plate now) and don't contradict the journey %.
  const roadmapDone = tasks.filter((t) => t.state === 'done').length;
  const prog = {
    done: roadmapDone,
    total: tasks.length,
    pct: tasks.length ? Math.round((roadmapDone / tasks.length) * 100) : 0,
  };
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
        background: '#ffffff',
        border: '1px solid rgba(31,27,21,0.09)',
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
            background: tab === k ? 'rgba(124,58,237,0.13)' : 'transparent',
            color: tab === k ? CY : 'rgba(31,27,21,0.4)',
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
        background: '#f8f7f3',
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
                  color: '#1f1b15',
                  letterSpacing: '-.3px',
                  margin: 0,
                }}
              >
                Overview
              </h1>
              <div
                style={{
                  fontSize: 13,
                  color: 'rgba(31,27,21,.55)',
                  marginTop: 3,
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
                  fontFamily: 'var(--mono)',
                  fontSize: 11.5,
                  color: 'rgba(31,27,21,0.5)',
                }}
              >
                <span style={{ color: '#1f1b15', fontWeight: 700 }}>{prog.pct}%</span>
                <span
                  style={{
                    width: 72,
                    height: 5,
                    borderRadius: 3,
                    background: 'rgba(31,27,21,0.1)',
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
                {needsYou > 0 && <span style={{ color: '#2563eb' }}>needs you {needsYou}</span>}
                {approve > 0 && <span style={{ color: '#d97706' }}>approve {approve}</span>}
              </div>
            </div>
            <div
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 9 }}
            >
              {toggle}
              <button
                type="button"
                onClick={onGenerate}
                disabled={generating}
                title="byte generates a roadmap tailored to your company"
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 10.5,
                  letterSpacing: '0.06em',
                  color: generating ? 'rgba(31,27,21,0.4)' : CY,
                  background: 'transparent',
                  border: '1px solid rgba(124,58,237,0.32)',
                  borderRadius: 8,
                  padding: '5px 11px',
                  cursor: generating ? 'default' : 'pointer',
                }}
              >
                {generating
                  ? 'byte is planning…'
                  : genRoadmap
                    ? '↻ regenerate roadmap'
                    : '✦ generate my roadmap'}
              </button>
            </div>
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
                background: 'linear-gradient(180deg, rgba(124,58,237,0.10), rgba(124,58,237,0.02))',
                border: '1px solid rgba(124,58,237,0.4)',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--mono)',
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
                  color: '#1f1b15',
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
                  color: '#ffffff',
                  background: CY,
                  border: 'none',
                  borderRadius: 9,
                  padding: '7px 16px',
                  cursor: 'pointer',
                }}
              >
                Start
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
    { accent: '#7c3aed', value: String(shipped), label: 'shipped' },
    { accent: '#9333ea', value: String(sessions), label: 'sessions' },
    { accent: '#16a34a', value: String(commits), label: 'commits' },
    { accent: '#d97706', value: `~${hours}h`, label: 'saved' },
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
        // light frosted card: white with a subtle accent-tinted top, soft shadow
        background: `linear-gradient(145deg, ${accent}12, #ffffff 55%)`,
        border: '1px solid rgba(31,27,21,0.08)',
        boxShadow: '0 6px 20px -10px rgba(31,27,21,0.18)',
      }}
    >
      {/* a soft accent sheen catching the top corner */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: -32,
          right: -22,
          width: 92,
          height: 92,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${accent}26, transparent 68%)`,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'relative',
          fontSize: 27,
          fontWeight: 750,
          color: '#1f1b15',
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
          fontFamily: 'var(--mono)',
          fontSize: 10.5,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'rgba(31,27,21,0.6)',
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
