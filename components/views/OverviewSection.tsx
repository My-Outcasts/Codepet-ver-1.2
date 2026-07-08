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
  const { brief, nextStep, library, tick, openDept, portalToTask } = useApp();
  const [tab, setTab] = useState<'roadmap' | 'map'>('roadmap');
  void tick; // re-read the live DEPTS (progress + load) after a task mutation

  // byte's real, per-company roadmap once generated; until then the canonical template.
  // On first Overview load byte builds it once, silently, and persists it (like the scaffold):
  // load the saved one, and if there isn't one yet, generate it. The route no-ops cheaply when
  // there's no real brief, and any failure just keeps the template — so it's safe while credits
  // are out. generateRoadmap() takes no arg: the route reads the founder's brief server-side.
  const [genRoadmap, setGenRoadmap] = useState<RoadmapTaskDef[] | null>(null);
  useEffect(() => {
    let live = true;
    loadSavedRoadmap().then((saved) => {
      if (!live) return;
      if (saved) {
        setGenRoadmap(saved);
        return;
      }
      generateRoadmap().then((fresh) => {
        if (live && fresh) setGenRoadmap(fresh);
      });
    });
    return () => {
      live = false;
    };
  }, []);
  const defs = genRoadmap ?? ROADMAP_TEMPLATE;

  const currentPhase = stageToPhase(brief.stage);
  const phaseTasks = defs.filter((t) => t.phase === currentPhase);
  // Guard the root label: ignore a placeholder-y project name (empty, single char, or all
  // digits like "1") and fall back to "Your company" rather than showing junk on the hero node.
  const rawName = brief.projectName?.trim() ?? '';
  const projectName = rawName.length >= 2 && !/^\d+$/.test(rawName) ? rawName : 'Your company';

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
  // breadth of progress: how many of the company's departments are underway (non-dormant)
  const totalAreas = DEPTS.length;
  const areasBuilding = DEPTS.filter((d) => !d.later).length;
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

  // The toggle adapts to its surface: light on the Roadmap tab, dark on the Second Brain tab
  // (which sits on the dark 3D map) so it blends instead of stranding a light bar on black.
  const onDark = tab === 'map';
  const toggle = (
    <div
      style={{
        flex: 'none',
        display: 'inline-flex',
        gap: 3,
        padding: 4,
        background: onDark ? 'rgba(18,16,28,0.72)' : '#ffffff',
        border: `1px solid ${onDark ? 'rgba(245,243,255,0.14)' : 'rgba(31,27,21,0.09)'}`,
        borderRadius: 11,
        backdropFilter: onDark ? 'blur(8px)' : undefined,
      }}
    >
      {(['roadmap', 'map'] as const).map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => setTab(k)}
          style={{
            fontFamily: 'var(--sans)',
            fontSize: 12.5,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            padding: '6px 14px',
            borderRadius: 8,
            border: 'none',
            cursor: 'pointer',
            background:
              tab === k
                ? onDark
                  ? 'rgba(124,58,237,0.32)'
                  : 'rgba(124,58,237,0.13)'
                : 'transparent',
            color:
              tab === k
                ? onDark
                  ? '#c4b5fd'
                  : CY
                : onDark
                  ? 'rgba(245,243,255,0.5)'
                  : 'rgba(31,27,21,0.4)',
          }}
        >
          {k === 'map' ? 'Second Brain' : 'Roadmap'}
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
        // anchor the app's sans (Google Sans Flex) so all bare text/buttons match the app,
        // not whatever `body` happens to resolve to; mono labels override with var(--mono)
        fontFamily: 'var(--sans)',
      }}
    >
      {tab === 'map' ? (
        // The map fills the whole tab (its own dark surface); the toggle floats on top so there's
        // no light strip seam between the toggle and the dark graph.
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <OverviewMap />
          <div style={{ position: 'absolute', top: 16, left: 24, zIndex: 10 }}>{toggle}</div>
        </div>
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
            {toggle}
          </div>

          {/* the single actionable next move — Start runs byte on the real task */}
          {move && (
            <div
              style={{
                flex: 'none',
                position: 'relative',
                overflow: 'hidden',
                margin: '6px 24px 0',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '9px 10px 9px 15px',
                borderRadius: 12,
                background: 'var(--accent-tint)',
                border: '1px solid var(--accent-line)',
              }}
            >
              <style>{`@keyframes beaconPing{0%{transform:scale(1);opacity:.5}70%,100%{transform:scale(2.9);opacity:0}}@media (prefers-reduced-motion:reduce){.rm-beacon-ping{animation:none!important}}`}</style>
              {/* soft radiance emanating from the beacon */}
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  left: -28,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 150,
                  height: 150,
                  borderRadius: '50%',
                  background: 'radial-gradient(circle, rgba(124,58,237,0.2), transparent 68%)',
                  pointerEvents: 'none',
                }}
              />
              {/* the beacon — byte's guide star, pinging like on the map */}
              <span
                style={{
                  position: 'relative',
                  flex: 'none',
                  width: 13,
                  height: 13,
                  display: 'inline-flex',
                }}
              >
                <span
                  aria-hidden
                  className="rm-beacon-ping"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '50%',
                    background: 'var(--accent)',
                    animation: 'beaconPing 2.2s ease-out infinite',
                  }}
                />
                <span
                  style={{
                    position: 'relative',
                    width: 13,
                    height: 13,
                    borderRadius: '50%',
                    background: 'var(--accent)',
                    boxShadow: '0 0 0 3px rgba(124,58,237,0.16), 0 0 12px 2px rgba(124,58,237,0.6)',
                  }}
                />
              </span>
              <span
                style={{
                  position: 'relative',
                  fontFamily: 'var(--mono)',
                  fontSize: 10,
                  letterSpacing: '0.13em',
                  textTransform: 'uppercase',
                  color: 'var(--accent)',
                  flex: 'none',
                }}
              >
                byte · do this next
              </span>
              <span
                style={{
                  position: 'relative',
                  fontFamily: 'var(--sans)',
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: 'var(--ink)',
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
                  position: 'relative',
                  marginLeft: 'auto',
                  flex: 'none',
                  fontFamily: 'var(--sans)',
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: '#ffffff',
                  background: 'var(--accent)',
                  border: 'none',
                  borderRadius: 9,
                  padding: '7px 18px',
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px -5px rgba(124,58,237,0.6)',
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
            areasBuilding={areasBuilding}
            totalAreas={totalAreas}
          />
        </div>
      )}
    </section>
  );
}

// Progress at a glance — two glowing stat cards that always carry real numbers (no dead
// zeros): SHIPPED = byte's approved deliverables (tangible output); AREAS BUILDING = how many
// of the company's departments are underway (breadth). The headline % + roadmap already own
// the journey progress, so this strip stays proof-of-work, not a repeat of the percentage.
function ProofStrip({
  shipped,
  areasBuilding,
  totalAreas,
}: {
  shipped: number;
  areasBuilding: number;
  totalAreas: number;
}) {
  const stats: { accent: string; value: string; label: string }[] = [
    { accent: '#7c3aed', value: String(shipped), label: 'shipped' },
    { accent: '#2dd4bf', value: `${areasBuilding}/${totalAreas}`, label: 'areas building' },
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
