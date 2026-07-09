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
// The two cards sit side by side, each ~HUD-sized (matching the Second Brain "building your
// company" card). The row is capped so they stay small.
const PANEL_W = 'min(430px, calc(100% - 48px))';

// The roadmap's state vocabulary — a small key so a first-time user can read the cards. Colors
// match RoadmapView's DOT map (state → dot color); labels match the plain-language status lines.
const LEGEND: [string, string][] = [
  ['#16a34a', 'Done'],
  ['#7c3aed', 'byte can do this'],
  ['#2563eb', 'Needs your input'],
  ['#d97706', 'Needs approval'],
  ['rgba(31,27,21,0.4)', 'Needs earlier steps'],
];

export default function OverviewSection() {
  const { brief, nextStep, tick, openDept, portalToTask, introSeen, markIntroSeen } = useApp();
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
  // the upcoming milestone (the phase after the current one) — the "next" pill on the bar
  const curPhaseIdx = ROADMAP_PHASES.findIndex((p) => p.key === currentPhase);
  const currentPhaseName = ROADMAP_PHASES[curPhaseIdx]?.name ?? '';
  const nextMilestone =
    ROADMAP_PHASES[curPhaseIdx + 1]?.name ?? ROADMAP_PHASES[ROADMAP_PHASES.length - 1]?.name ?? '';
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
  // the one actionable nudge kept on the compact card: tasks that need the founder
  let needsYou = 0;
  for (const d of DEPTS) {
    for (const t of d.tasks) {
      if (!t.done && !t.drafted && t.who === 'you') needsYou += 1;
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
        // not whatever `body` happens to resolve to (all labels use Google Sans Flex now)
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
          {/* First-run: byte introduces the map in its own voice, shown once per account
              (introSeen is account-scoped, persisted to companies/{uid}.introSeenAt). */}
          {!introSeen && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="How the roadmap works"
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 30,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
                background: 'rgba(31,27,21,0.34)',
                backdropFilter: 'blur(2px)',
              }}
            >
              <div
                style={{
                  width: 'min(440px, 100%)',
                  background: '#ffffff',
                  border: '1px solid rgba(31,27,21,0.08)',
                  borderRadius: 20,
                  boxShadow: '0 30px 80px -30px rgba(31,27,21,0.55)',
                  padding: '26px 26px 22px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 15 }}>
                  <span
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      flex: 'none',
                      background: 'linear-gradient(160deg, #9333ea, #7c3aed)',
                      boxShadow: '0 8px 22px -8px rgba(124,58,237,0.7)',
                    }}
                  />
                  <div>
                    <div
                      style={{
                        fontSize: 10.5,
                        fontWeight: 650,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: CY,
                      }}
                    >
                      byte
                    </div>
                    <div
                      style={{
                        fontSize: 19,
                        fontWeight: 680,
                        color: '#1f1b15',
                        letterSpacing: '-0.01em',
                        marginTop: 1,
                      }}
                    >
                      Your company, mapped
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 14.5,
                    lineHeight: 1.5,
                    color: 'rgba(31,27,21,0.72)',
                    marginBottom: 16,
                  }}
                >
                  This whole map is your company, one step at a time. Here’s how to read it:
                </div>
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 11, marginBottom: 22 }}
                >
                  {(
                    [
                      ['#16a34a', 'Green is done', 'how far you’ve already come.'],
                      [
                        '#7c3aed',
                        'The glowing card is your next move',
                        'hit Start and I’ll get to work.',
                      ],
                      [
                        'rgba(31,27,21,0.4)',
                        'Greyed-out steps are locked',
                        'they unlock as you finish what they depend on.',
                      ],
                    ] as [string, string, string][]
                  ).map(([c, h, b]) => (
                    <div key={h} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: c,
                          marginTop: 6,
                          flex: 'none',
                        }}
                      />
                      <div
                        style={{ fontSize: 13.5, lineHeight: 1.45, color: 'rgba(31,27,21,0.72)' }}
                      >
                        <span style={{ fontWeight: 650, color: '#1f1b15' }}>{h}</span> — {b}
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={markIntroSeen}
                  style={{
                    width: '100%',
                    fontFamily: 'var(--sans)',
                    fontSize: 14,
                    fontWeight: 650,
                    color: '#ffffff',
                    background: '#7c3aed',
                    border: 'none',
                    borderRadius: 12,
                    padding: '11px 18px',
                    cursor: 'pointer',
                    boxShadow: '0 8px 22px -8px rgba(124,58,237,0.7)',
                  }}
                >
                  Got it — show me
                </button>
              </div>
            </div>
          )}
          {/* Compact header — the roadmap below is the hero, so the top stays slim. */}
          <div
            style={{
              flex: 'none',
              padding: '14px 24px 0',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 16,
            }}
          >
            <div>
              <h1
                style={{
                  fontSize: 28,
                  fontWeight: 650,
                  color: '#1f1b15',
                  letterSpacing: '-.5px',
                  margin: 0,
                }}
              >
                Overview
              </h1>
              <div
                style={{
                  fontSize: 15,
                  lineHeight: 1.45,
                  color: 'rgba(31,27,21,.62)',
                  marginTop: 4,
                  whiteSpace: 'nowrap',
                }}
              >
                Your whole company as a roadmap — where you are, what byte does next, and how far
                you’ve come.
              </div>
            </div>
            {toggle}
          </div>

          {/* Project Progress + Do This Next side by side — one compact top strip so the roadmap
              below gets the space (and the wide right-hand void goes away). */}
          <style>{`.rm-pfill::before{content:"";position:absolute;inset:-5px;border-radius:999px;background:inherit;filter:blur(11px);opacity:.5;z-index:-1}`}</style>
          <div
            style={{
              flex: 'none',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 24,
              margin: '16px 24px 0 24px',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'stretch',
                gap: 14,
                width: PANEL_W,
              }}
            >
              <div
                style={{
                  flex: '1 1 170px',
                  minWidth: 0,
                  boxSizing: 'border-box',
                  padding: '9px 13px 10px',
                  borderRadius: 14,
                  background: '#ffffff',
                  border: '1px solid rgba(31,27,21,0.08)',
                  boxShadow: '0 6px 20px -14px rgba(31,27,21,0.3)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span
                    style={{
                      fontFamily: 'var(--sans)',
                      fontSize: 12.5,
                      fontWeight: 650,
                      color: 'var(--ink)',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    Project Progress
                  </span>
                  {currentPhaseName && (
                    <span
                      style={{
                        fontFamily: 'var(--sans)',
                        fontSize: 10,
                        fontWeight: 600,
                        color: 'var(--accent)',
                        background: 'var(--accent-tint)',
                        border: '1px solid var(--accent-line)',
                        padding: '2px 7px',
                        borderRadius: 999,
                      }}
                    >
                      {currentPhaseName}
                    </span>
                  )}
                </div>

                <div
                  style={{ margin: '3px 0 6px', display: 'flex', alignItems: 'baseline', gap: 9 }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--sans)',
                      fontWeight: 750,
                      letterSpacing: '-0.03em',
                      lineHeight: 1,
                      color: 'var(--ink)',
                    }}
                  >
                    <span style={{ fontSize: 22, fontVariantNumeric: 'tabular-nums' }}>
                      {prog.pct}
                    </span>
                    <span style={{ fontSize: 13, color: 'rgba(31,27,21,0.4)' }}>%</span>
                  </span>
                  {needsYou > 0 && (
                    <span style={{ fontFamily: 'var(--sans)', fontSize: 12, color: '#2563eb' }}>
                      needs you {needsYou}
                    </span>
                  )}
                </div>

                <div
                  style={{
                    position: 'relative',
                    height: 14,
                    borderRadius: 999,
                    background: 'rgba(31,27,21,0.07)',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <div
                    className="rm-pfill"
                    style={{
                      position: 'relative',
                      height: '100%',
                      width: `${prog.pct}%`,
                      minWidth: prog.pct > 0 ? 14 : 0,
                      borderRadius: 999,
                      background: 'linear-gradient(90deg, #7c3aed, #a855f7)',
                      boxShadow: '0 0 11px 1px rgba(124,58,237,0.5)',
                      transition: 'width .8s cubic-bezier(.2,.8,.2,1)',
                    }}
                  />
                  {nextMilestone && (
                    <span
                      style={{
                        position: 'absolute',
                        right: 5,
                        fontFamily: 'var(--sans)',
                        fontSize: 10.5,
                        fontWeight: 600,
                        color: 'var(--accent)',
                        background: 'rgba(124,58,237,0.12)',
                        padding: '2px 8px',
                        borderRadius: 999,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Next: {nextMilestone}
                    </span>
                  )}
                </div>
              </div>

              {/* the single actionable next move — Start runs byte on the real task */}
              {move && (
                <div
                  style={{
                    flex: '1 1 170px',
                    minWidth: 0,
                    boxSizing: 'border-box',
                    position: 'relative',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: 6,
                    padding: '9px 13px 11px',
                    borderRadius: 12,
                    background: 'var(--accent-tint)',
                    border: '1px solid var(--accent-line)',
                  }}
                >
                  <style>{`@keyframes beaconPing{0%{transform:scale(1);opacity:.5}70%,100%{transform:scale(2.9);opacity:0}}@media (prefers-reduced-motion:reduce){.rm-beacon-ping{animation:none!important}}`}</style>
                  {/* beacon + label on one row, then the title and Start stacked below */}
                  <span
                    style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    <span
                      style={{
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
                          boxShadow:
                            '0 0 0 3px rgba(124,58,237,0.16), 0 0 12px 2px rgba(124,58,237,0.6)',
                        }}
                      />
                    </span>
                    <span
                      style={{
                        position: 'relative',
                        fontFamily: 'var(--sans)',
                        fontSize: 10,
                        letterSpacing: '0.13em',
                        textTransform: 'uppercase',
                        color: 'var(--accent)',
                        flex: 'none',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      byte · do this next
                    </span>
                  </span>
                  <span
                    style={{
                      position: 'relative',
                      fontFamily: 'var(--sans)',
                      fontSize: 13,
                      fontWeight: 650,
                      color: 'var(--ink)',
                      lineHeight: 1.3,
                    }}
                  >
                    {move.title}
                  </span>
                  <button
                    type="button"
                    onClick={startMove}
                    style={{
                      position: 'relative',
                      marginTop: 3,
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
            </div>
            {/* states key — teaches a first-time user what the card colors mean */}
            <div
              style={{
                flex: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 7,
                paddingTop: 2,
                fontFamily: 'var(--sans)',
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 650,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'rgba(31,27,21,0.4)',
                  marginBottom: 1,
                }}
              >
                Key
              </span>
              {LEGEND.map(([color, label]) => (
                <span
                  key={label}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 11.5,
                    color: 'rgba(31,27,21,0.6)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: color,
                      flex: 'none',
                    }}
                  />
                  {label}
                </span>
              ))}
            </div>
          </div>
          {/* roadmap — the hero. RoadmapView measures this area and scales the diagram up to
              fill the height (capped), so short roadmaps no longer leave dead space below. */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              padding: '14px 24px 14px',
            }}
          >
            <RoadmapView
              tasks={tasks}
              phases={ROADMAP_PHASES}
              projectName={projectName}
              onTaskClick={onTaskClick}
            />
          </div>
        </div>
      )}
    </section>
  );
}
