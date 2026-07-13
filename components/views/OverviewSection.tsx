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
import { companionById } from '@/lib/companions';
import { cleanCompanyName, meaningfulText } from '@/lib/companyName';
import RoadmapView from './overview/RoadmapView';
import { ROADMAP_TEMPLATE, ROADMAP_PHASES } from '@/lib/overview/roadmapTemplate';
import { stageToPhase } from '@/lib/overview/roadmapProgress';
import { selectRoadmap } from '@/lib/overview/roadmapSelector';
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

// Accent for byte's labels/CTAs here — the live token, so it brightens on the dark ground and
// follows the active companion. Used only in DOM styles (not SVG attributes), so var() is safe.
const CY = 'var(--accent)';
// The two cards sit side by side, each ~HUD-sized (matching the Second Brain "building your
// company" card). The row is capped so they stay small.
const PANEL_W = 'min(430px, calc(100% - 48px))';

// The roadmap's state vocabulary — a small key so a first-time user can read the cards. Colors
// match RoadmapView's DOT map (state → dot color); labels match the plain-language status lines.
// `name` is the active companion's name so the key says e.g. "Nova can do this", not always "byte".
const legendFor = (name: string): [string, string][] => [
  ['#16a34a', 'Done'],
  ['var(--accent)', `${name} can do this`],
  ['#2563eb', 'Needs your input'],
  ['#d97706', 'Needs approval'],
  ['var(--t-3)', 'Needs earlier steps'],
];

export default function OverviewSection() {
  const {
    brief,
    tick,
    guideRoadmapTask,
    introSeen,
    markIntroSeen,
    projectAnalysis,
    aiOffline,
    roadmapDefs,
    companionId,
  } = useApp();
  // The active companion's name drives every "byte"-labelled surface here, so picking Nova (etc.)
  // renames "byte · do this next", the "byte is here" beacon, and the key — not just the accent.
  const companionName = companionById(companionId).name;
  const LEGEND = legendFor(companionName);
  const [tab, setTab] = useState<'roadmap' | 'map'>('roadmap');
  // Preview/QA escape hatch: `?intro=1` forces byte's first-run intro even for an account that
  // has already dismissed it. Non-destructive — no account data is touched.
  const [forceIntro] = useState(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('intro'),
  );
  const [introDismissed, setIntroDismissed] = useState(false);
  // Persistent re-open: the first-run briefing auto-shows once per account, but "How to read this
  // map" (always in the header) can reopen it any time — so the instructions are never lost after
  // the one-time dismissal, on any account or visit.
  const [introReopened, setIntroReopened] = useState(false);
  const showIntro = introReopened || ((!introSeen || forceIntro) && !introDismissed);
  const openIntro = () => setIntroReopened(true);
  const dismissIntro = () => {
    setIntroReopened(false);
    setIntroDismissed(true);
    markIntroSeen();
  };
  void tick; // re-read the live DEPTS (progress + load) after a task mutation

  // byte's real, per-company roadmap — owned by the store (loaded/generated once there), so the
  // beacon here and the chat's next-step derive from the SAME source. Falls back to the template.
  const defs = roadmapDefs ?? ROADMAP_TEMPLATE;

  // The founder's phase floors at their declared stage; it ADVANCES below (after overrides are
  // known) as they finish work, so completing a phase moves the beacon to the next real step.
  const stagePhase = stageToPhase(brief.stage);
  // Guard the root label: ignore a placeholder-y project name (empty, single char, all digits
  // like "1", or a raw signup email) and fall back to "Your company" rather than showing junk
  // on the hero node.
  const projectName = cleanCompanyName(brief.projectName) ?? 'Your company';
  // byte's one-line read of the company, for the first-run briefing. Falls back through the
  // brief's own fields when the AI analysis hasn't been generated yet. `meaningfulText` (shared
  // with the brief-normalization boundary) drops placeholder-y junk so the briefing never shows
  // garbage.
  const summary =
    meaningfulText(projectAnalysis?.overall) ||
    meaningfulText(brief.summary) ||
    meaningfulText(brief.oneLiner);
  // Header identity: once we know the company, say whose it is and what it is; otherwise the
  // generic framing. Uses the short one-liner (truncated) so it stays a single tidy line.
  const oneLiner = meaningfulText(brief.oneLiner);
  const headerLine =
    projectName !== 'Your company' && oneLiner
      ? `${projectName} — ${oneLiner}`
      : `Your whole company as a roadmap — where you are, what ${companionName} does next, and how far you’ve come.`;

  // ONE roadmap projection: the beacon + lit map node here, and — via the store — the chat's
  // next-step, the first-run greeting, and the after-completion nudge all read from this single
  // selector, so no two surfaces can disagree about the phase, the next move, its department, or
  // how far along the founder is. All the derivation lives in selectRoadmap (pure + tested).
  const {
    move,
    tasks,
    phaseName: currentPhaseName,
    nextMilestone,
    progress: prog,
  } = selectRoadmap(defs, stagePhase, DEPTS);

  // Start runs byte on the current move's real task, in its own canonical dept/title so the
  // beacon, the lit map node, and the chat all name the same thing.
  const startMove = () => {
    if (move)
      guideRoadmapTask({
        deptK: move.deptK,
        title: move.title,
        state: 'current',
        nodeId: move.id,
        actor: move.actor,
      });
  };
  // the one actionable nudge kept on the compact card: tasks that need the founder
  let needsYou = 0;
  for (const d of DEPTS) {
    for (const t of d.tasks) {
      if (!t.done && !t.drafted && t.who === 'you') needsYou += 1;
    }
  }
  // When the primary move is byte's to run, the founder often ALSO has a step waiting on them.
  // Surface the top one as a distinct secondary line under Start (never the same task as the
  // move), so the two calls-to-action read as ordered — do this, then that — not as rivals.
  const needsYouTask = move
    ? tasks.find((t) => t.state === 'needsYou' && t.title !== move.title)
    : undefined;

  // Click a card: route into the chat by the card's state — run/review it in-thread when byte
  // can, guide the founder when it's theirs, or explain what's blocking a locked step (naming the
  // unfinished prerequisite so it's never a dead-end). One shared handler, every surface.
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const onTaskClick = (task: RoadmapTask) => {
    const blockedBy =
      task.state === 'locked'
        ? task.dependsOn.map((id) => byId.get(id)).find((t) => t && t.state !== 'done')?.title
        : undefined;
    guideRoadmapTask({
      deptK: task.dept,
      title: task.title,
      state: task.state,
      blockedBy,
      nodeId: task.id,
      actor: task.actor,
    });
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
        background: onDark ? 'rgba(18,16,28,0.72)' : 'var(--surface)',
        border: `1px solid ${onDark ? 'rgba(245,243,255,0.14)' : 'var(--hairline)'}`,
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
                  ? 'color-mix(in srgb, var(--accent) 30%, transparent)'
                  : 'var(--accent-tint)'
                : 'transparent',
            color: tab === k ? 'var(--accent)' : onDark ? 'rgba(245,243,255,0.5)' : 'var(--t-3)',
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
        background: 'var(--page)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        // anchor the app's sans (Google Sans Flex) so all bare text/buttons match the app,
        // not whatever `body` happens to resolve to (all labels use Google Sans Flex now)
        fontFamily: 'var(--sans)',
      }}
    >
      {/* One honest, up-front offline state — so a founder knows byte is paused before trying a
          run or chat, instead of hitting a per-message "temporarily unavailable". */}
      {aiOffline && (
        <div
          role="status"
          style={{
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '9px 24px',
            background: 'rgba(217,119,6,0.1)',
            borderBottom: '1px solid rgba(217,119,6,0.22)',
            fontFamily: 'var(--sans)',
            fontSize: 13,
            color: 'var(--gold-deep)',
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: '#d97706',
              flex: 'none',
            }}
          />
          <span>
            <strong style={{ fontWeight: 650 }}>byte is paused.</strong>{' '}
            {aiOffline.code === 'rate_limited'
              ? 'Today’s usage limit is reached — it resets tomorrow. Runs and chat are on hold until then.'
              : 'The workspace is out of AI credits — top it up in the Anthropic console and byte picks right back up. Runs and chat are on hold until then.'}
          </span>
        </div>
      )}
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
          {showIntro && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="How the roadmap works"
              onClick={dismissIntro}
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
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: 'min(440px, 100%)',
                  background: 'var(--surface)',
                  border: '1px solid var(--hairline)',
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
                      background: 'linear-gradient(160deg, var(--accent-deep), var(--accent))',
                      boxShadow:
                        '0 8px 22px -8px color-mix(in srgb, var(--accent) 70%, transparent)',
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
                      {companionName}
                    </div>
                    <div
                      style={{
                        fontSize: 19,
                        fontWeight: 680,
                        color: 'var(--t-1)',
                        letterSpacing: '-0.01em',
                        marginTop: 1,
                      }}
                    >
                      {projectName === 'Your company'
                        ? 'Your company, mapped'
                        : `${projectName}, mapped`}
                    </div>
                  </div>
                </div>
                {summary && (
                  <div
                    style={{
                      fontSize: 14.5,
                      lineHeight: 1.5,
                      color: 'var(--t-2)',
                      marginBottom: 14,
                    }}
                  >
                    {summary}
                  </div>
                )}
                <div
                  style={{
                    fontSize: 13.5,
                    lineHeight: 1.5,
                    color: 'var(--t-2)',
                    background: 'var(--accent-tint)',
                    border: '1px solid var(--accent-line)',
                    borderRadius: 12,
                    padding: '11px 13px',
                    marginBottom: 16,
                  }}
                >
                  <span style={{ fontWeight: 650, color: 'var(--t-1)' }}>
                    You’re in the {currentPhaseName || 'first'} phase
                  </span>
                  {nextMilestone ? ` — next milestone: ${nextMilestone}.` : '.'}
                  {move?.title && (
                    <>
                      {' '}
                      First up: <span style={{ fontWeight: 650, color: CY }}>{move.title}</span>.
                    </>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 650,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--t-3)',
                    marginBottom: 10,
                  }}
                >
                  How to read the map
                </div>
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 11, marginBottom: 22 }}
                >
                  {(
                    [
                      ['#16a34a', 'Green is done', 'how far you’ve already come.'],
                      [
                        'var(--accent)',
                        'The glowing card is your next move',
                        'hit Start and I’ll get to work.',
                      ],
                      [
                        'var(--t-3)',
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
                      <div style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--t-2)' }}>
                        <span style={{ fontWeight: 650, color: 'var(--t-1)' }}>{h}</span> — {b}
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={dismissIntro}
                  style={{
                    width: '100%',
                    fontFamily: 'var(--sans)',
                    fontSize: 14,
                    fontWeight: 650,
                    color: 'var(--on-accent)',
                    background: 'var(--accent)',
                    border: 'none',
                    borderRadius: 12,
                    padding: '11px 18px',
                    cursor: 'pointer',
                    boxShadow: '0 8px 22px -8px color-mix(in srgb, var(--accent) 70%, transparent)',
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
                  color: 'var(--t-1)',
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
                  color: 'var(--t-3)',
                  marginTop: 4,
                  // Wrap to at most two lines so the full subtitle shows instead of being
                  // cut off mid-word — while still bounding a long dynamic company one-liner.
                  display: '-webkit-box',
                  WebkitBoxOrient: 'vertical',
                  WebkitLineClamp: 2,
                  overflow: 'hidden',
                  maxWidth: 'min(760px, 62vw)',
                }}
                title={headerLine}
              >
                {headerLine}
              </div>
            </div>
            <div style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                onClick={openIntro}
                title="How to read this map"
                style={{
                  fontFamily: 'var(--sans)',
                  fontSize: 12.5,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '7px 13px',
                  borderRadius: 10,
                  cursor: 'pointer',
                  color: CY,
                  background: 'var(--accent-tint)',
                  border: '1px solid var(--accent-line)',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 15,
                    height: 15,
                    flex: 'none',
                    borderRadius: '50%',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    fontWeight: 700,
                    color: 'var(--on-accent)',
                    background: CY,
                  }}
                >
                  ?
                </span>
                How to read this map
              </button>
              {toggle}
            </div>
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
                  background: 'var(--surface)',
                  border: '1px solid var(--hairline)',
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
                    <span style={{ fontSize: 13, color: 'var(--t-3)' }}>%</span>
                  </span>
                  {needsYou > 0 && (
                    <span style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--blue)' }}>
                      needs you {needsYou}
                    </span>
                  )}
                </div>

                <div
                  style={{
                    position: 'relative',
                    height: 14,
                    borderRadius: 999,
                    background: 'var(--well)',
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
                      background: 'linear-gradient(90deg, var(--accent-deep), var(--accent))',
                      boxShadow: '0 0 11px 1px color-mix(in srgb, var(--accent) 50%, transparent)',
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
                        background: 'var(--accent-tint)',
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
                            '0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent), 0 0 12px 2px color-mix(in srgb, var(--accent) 60%, transparent)',
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
                      {companionName} · do this next
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
                      color: 'var(--on-accent)',
                      background: 'var(--accent)',
                      border: 'none',
                      borderRadius: 9,
                      padding: '7px 18px',
                      cursor: 'pointer',
                      boxShadow:
                        '0 4px 14px -5px color-mix(in srgb, var(--accent) 60%, transparent)',
                    }}
                  >
                    Start
                  </button>
                  {needsYouTask && (
                    <button
                      type="button"
                      onClick={() => onTaskClick(needsYouTask)}
                      title={`Also needs you: ${needsYouTask.title}`}
                      style={{
                        position: 'relative',
                        marginTop: 2,
                        maxWidth: '100%',
                        display: 'inline-flex',
                        alignItems: 'baseline',
                        gap: 5,
                        textAlign: 'left',
                        fontFamily: 'var(--sans)',
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--blue)',
                        background: 'transparent',
                        border: 'none',
                        padding: 0,
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ flex: 'none', opacity: 0.75 }}>Also needs you:</span>
                      <span
                        style={{
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          textDecoration: 'underline',
                          textUnderlineOffset: 2,
                        }}
                      >
                        {needsYouTask.title}
                      </span>
                    </button>
                  )}
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
                  color: 'var(--t-3)',
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
                    color: 'var(--t-3)',
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
              companionName={companionName}
              onTaskClick={onTaskClick}
            />
          </div>
        </div>
      )}
    </section>
  );
}
