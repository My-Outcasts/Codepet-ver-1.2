'use client';
// The Overview roadmap, phase 1 — the read-only view.
//
// A thin renderer over the pure layout engine (lib/overview/roadmapLayout): it takes the
// phases + tasks, gets back node boxes and orthogonal edge paths, and draws them. Columns
// are phases, rows are tasks, edges are dependencies; the critical path (edges touching
// byte's current move) is lit cyan, everything else is a faint dotted dependency. The whole
// thing begins at a distinct company root node the tree fans out of.
//
// Self-contained inline styles (no globals.css dependency) so it renders standalone in the
// preview route without touching the concurrently-evolving app shell.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { layoutRoadmap, CARD_W, CARD_H, type PositionedNode } from '@/lib/overview/roadmapLayout';
import { ROADMAP_PHASES, DEPT_LABEL } from '@/lib/overview/roadmapTemplate';
import type { RoadmapPhase, RoadmapState, RoadmapTask } from '@/lib/overview/roadmapModel';

// Everything accent-driven follows the companion (byte violet, Nova gold, …) + light/dark, via
// the accent tokens. CY/VIO are used only in inline styles here; the SVG critical-path/edge lines
// set `stroke` through the `style` prop (not the attribute), where var() IS parsed — so the whole
// map re-tints with the chosen companion, not just the chrome around it.
const CY = 'var(--accent)';
const VIO = 'var(--accent-deep)';
const TX = 'var(--t-1)';
const TX3 = 'var(--t-3)';
const LINE = 'var(--hairline)';
// Card surface/border/locked-fade come from roadmap-local tokens (globals.css): on the cream
// ground they resolve to the default surface + hairline; dark overrides them so the cards keep a
// visible edge and locked cards don't fade into the near-black page. Driven by data-theme, so it
// also renders correctly in the standalone preview route.
const CARD_BG = 'var(--rm-card-bg)';
const CARD_BORDER = 'var(--rm-card-border)';
const LOCKED_OP = 'var(--rm-locked-op)';
const CHIP_BG = 'var(--rm-chip-bg)';
const CHIP_BORDER = 'var(--rm-chip-border)';

// State → the node's icon-dot color.
const DOT: Record<RoadmapState, string> = {
  done: '#16a34a',
  current: CY,
  available: CY,
  needsYou: '#2563eb',
  approve: '#d97706',
  locked: TX3,
};
// State → a plain-language status line under the task title (cofounder-style): the actor +
// what's needed, so the founder reads intent directly instead of decoding a corner badge. The
// `available` label names the active companion, so it's built per-render (see statusFor).
const STATUS: Record<RoadmapState, string> = {
  done: 'Done',
  current: 'Up next',
  available: 'Codepet can do this',
  needsYou: 'Needs your input',
  approve: 'Needs approval',
  locked: 'Needs earlier steps',
};
const statusFor = (st: RoadmapState, companionName: string): string =>
  st === 'available' ? `${companionName} can do this` : STATUS[st];

// The peek's plain-language "who does it + what to do" line — the founder learns a card without
// opening chat first. Names the active companion so it reads as their cofounder talking.
const peekSentence = (st: RoadmapState, companionName: string): string => {
  switch (st) {
    case 'done':
      return 'Finished — click to open the result.';
    case 'current':
      return `${companionName}'s next move. Click to start.`;
    case 'available':
      return `${companionName} can run this now. Click to start.`;
    case 'needsYou':
      return 'Your input needed. Click to add it.';
    case 'approve':
      return 'Ready for your review.';
    case 'locked':
      return 'Locked — finish the earlier steps first.';
  }
};

/** What the peek needs beyond the node itself: its context tag and dependency chain, computed
 *  once in RoadmapView (it has every task) so the card doesn't re-derive them. */
interface Peek {
  deptLabel: string;
  phaseName: string;
  /** Unfinished prerequisites — shown on a locked card as "Unlocks after: …". */
  blockedTitles: string[];
  /** Tasks this one unblocks — shown as "Leads to: …" so the founder sees why it matters. */
  unlocksTitles: string[];
  /** Anchor the popover above the card (bottom-row cards, where below would clip). */
  flip: boolean;
}

// Actionable states earn a verb the founder can act on; done/locked stay quiet labels. The single
// `current` move is the ONLY filled chip — everything else is an outline — so the map has exactly
// one unmistakable hero and no competing bright call-to-action.
const VERB: Partial<Record<RoadmapState, string>> = {
  current: 'Start',
  available: 'Start',
  approve: 'Review',
  needsYou: 'Add your input',
};
const CHIP_BASE = {
  display: 'inline-flex',
  alignItems: 'center',
  marginTop: 4,
  fontSize: 10,
  fontWeight: 700,
  padding: '2px 9px',
  borderRadius: 999,
  whiteSpace: 'nowrap',
} as const;
const chipStyle = (st: RoadmapState): CSSProperties => {
  switch (st) {
    case 'current':
      return { ...CHIP_BASE, color: 'var(--on-accent)', background: CY, border: `1px solid ${CY}` };
    case 'available':
      return {
        ...CHIP_BASE,
        color: CY,
        background: 'var(--accent-tint)',
        border: '1px solid var(--accent-line)',
      };
    case 'approve':
      return {
        ...CHIP_BASE,
        color: '#d97706',
        background: 'rgba(217,119,6,0.10)',
        border: '1px solid rgba(217,119,6,0.35)',
      };
    case 'needsYou':
      return {
        ...CHIP_BASE,
        color: '#2563eb',
        background: 'rgba(37,99,235,0.10)',
        border: '1px solid rgba(37,99,235,0.32)',
      };
    default:
      return CHIP_BASE;
  }
};

function Node({
  node,
  onClick,
  pulse,
  companionName,
  hereLabel,
  peek,
}: {
  node: PositionedNode;
  onClick?: () => void;
  pulse?: boolean;
  companionName: string;
  hereLabel: string;
  peek: Peek;
}) {
  const { task } = node;
  const st = task.state;
  const done = st === 'done';
  const current = st === 'current';
  const locked = st === 'locked';
  return (
    <div
      className={[onClick && 'rm-node', pulse && 'rm-pulse'].filter(Boolean).join(' ') || undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      style={{
        position: 'absolute',
        left: node.x,
        top: node.y,
        width: CARD_W,
        height: CARD_H,
        borderRadius: 11,
        // OPAQUE fills (mix the tint over the card surface, never `transparent`) so a dependency
        // line running behind a card can't bleed THROUGH it — done/current cards used to be
        // see-through, which made the connectors look like they cut across the cards.
        background: current
          ? 'linear-gradient(180deg, color-mix(in srgb, var(--accent) 10%, var(--rm-card-bg)), color-mix(in srgb, var(--accent) 2%, var(--rm-card-bg)))'
          : done
            ? 'color-mix(in srgb, #16a34a 6%, var(--rm-card-bg))'
            : CARD_BG,
        border: `1px solid ${current ? 'color-mix(in srgb, var(--accent) 60%, transparent)' : done ? 'rgba(22,163,74,0.22)' : CARD_BORDER}`,
        boxShadow: current
          ? '0 0 0 1px color-mix(in srgb, var(--accent) 20%, transparent), 0 10px 30px -12px color-mix(in srgb, var(--accent) 60%, transparent)'
          : 'none',
      }}
    >
      {/* Content layer — the locked fade lives HERE, not on the card, so the card stays opaque
          (a faded element would let the lines behind show through). */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          padding: '0 12px',
          borderRadius: 11,
          opacity: locked ? LOCKED_OP : 1,
        }}
      >
        {current && (
          <span
            style={{
              position: 'absolute',
              top: -32,
              left: -1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: 'var(--surface)',
              border: '1px solid color-mix(in srgb, var(--accent) 50%, transparent)',
              borderRadius: 999,
              padding: '3px 9px 3px 4px',
              boxShadow: '0 6px 20px -8px color-mix(in srgb, var(--accent) 60%, transparent)',
            }}
          >
            <span
              style={{
                width: 17,
                height: 17,
                borderRadius: 5,
                background: `linear-gradient(160deg, ${VIO}, ${CY})`,
              }}
            />
            <span
              style={{
                fontFamily: 'var(--sans)',
                fontSize: 9.5,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: CY,
              }}
            >
              {hereLabel} is here
            </span>
          </span>
        )}
        {locked && (
          <span
            style={{
              position: 'absolute',
              top: 9,
              right: 10,
              width: 10,
              height: 10,
              border: `1.5px solid ${TX3}`,
              borderBottomWidth: 4.5,
              borderRadius: 3,
              opacity: 0.9,
            }}
          />
        )}
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            flex: 'none',
            display: 'grid',
            placeItems: 'center',
            background: done ? 'rgba(22,163,74,0.14)' : CHIP_BG,
            border: `1px solid ${done ? 'rgba(22,163,74,0.3)' : CHIP_BORDER}`,
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: done ? '50%' : 3,
              background: DOT[st],
              display: 'block',
            }}
          />
        </span>
        <span style={{ minWidth: 0 }}>
          <span
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              fontSize: 12.5,
              fontWeight: 600,
              color: TX,
              lineHeight: 1.2,
              overflow: 'hidden',
              maxWidth: 150,
            }}
          >
            {task.title}
          </span>
          {VERB[st] ? (
            <span style={chipStyle(st)}>{VERB[st]}</span>
          ) : (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                marginTop: 4,
                fontSize: 10,
                fontWeight: 600,
                color: DOT[st],
                whiteSpace: 'nowrap',
              }}
            >
              {statusFor(st, companionName)}
            </span>
          )}
        </span>
      </div>
      {/* Hover/focus peek — learn the card (context, who does it, what it unlocks) without opening
          chat. Purely presentational (pointer-events:none via .rm-peek); the card handles clicks. */}
      {onClick && (
        <span
          className="rm-peek"
          role="tooltip"
          style={{
            position: 'absolute',
            left: 0,
            [peek.flip ? 'bottom' : 'top']: 'calc(100% + 8px)',
            width: 226,
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
            padding: '10px 12px',
            borderRadius: 10,
            background: 'var(--surface)',
            border: `1px solid ${CARD_BORDER}`,
            boxShadow: '0 14px 34px -14px rgba(0,0,0,0.45)',
            textAlign: 'left',
          }}
        >
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: '0.09em',
              textTransform: 'uppercase',
              color: TX3,
            }}
          >
            {peek.deptLabel}
            {peek.phaseName ? ` · ${peek.phaseName}` : ''}
          </span>
          <span style={{ fontSize: 11.5, fontWeight: 550, color: TX, lineHeight: 1.35 }}>
            {peekSentence(st, companionName)}
          </span>
          {locked && peek.blockedTitles.length > 0 && (
            <span style={{ fontSize: 10.5, color: TX3, lineHeight: 1.35 }}>
              Unlocks after:{' '}
              <span style={{ color: TX, fontWeight: 600 }}>{peek.blockedTitles.join(', ')}</span>
            </span>
          )}
          {!locked && peek.unlocksTitles.length > 0 && (
            <span style={{ fontSize: 10.5, color: TX3, lineHeight: 1.35 }}>
              Leads to:{' '}
              <span style={{ color: TX, fontWeight: 600 }}>
                {peek.unlocksTitles.slice(0, 3).join(', ')}
              </span>
            </span>
          )}
        </span>
      )}
    </div>
  );
}

export default function RoadmapView({
  phases = ROADMAP_PHASES,
  tasks,
  projectName = 'Your company',
  companionName = 'Codepet',
  hereLabel = 'You',
  onTaskClick,
}: {
  phases?: RoadmapPhase[];
  tasks: RoadmapTask[];
  projectName?: string;
  /** The active companion's name — labels the "… can do this" status line. */
  companionName?: string;
  /** Whose position the beacon marks — the founder's name, or 'You' when unknown. */
  hereLabel?: string;
  /** Click a task card — the current move starts the companion, others open their department. */
  onTaskClick?: (task: RoadmapTask) => void;
}) {
  const L = layoutRoadmap(phases, tasks);
  const nonCrit = L.edges.filter((e) => !e.critical);
  const crit = L.edges.filter((e) => e.critical);

  // Peek context, built once here where every task is in hand: id→task, the reverse-dependency
  // map (what each task unblocks), and phase-key→name. The Node reads these instead of re-deriving.
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const unlocks = new Map<string, string[]>();
  for (const t of tasks)
    for (const dep of t.dependsOn) unlocks.set(dep, [...(unlocks.get(dep) ?? []), t.title]);
  const phaseName = new Map(phases.map((p) => [p.key, p.name]));

  // Measure the available height and scale the whole diagram up to fill it (capped), so a
  // short roadmap doesn't leave dead space below. The pure layout stays at natural size —
  // we only apply a visual transform on top of it.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setAvail(el.clientHeight));
    ro.observe(el);
    setAvail(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  const HEADER_BLOCK = 34; // phase-header row (28) + its 6px bottom margin
  const natH = L.height + HEADER_BLOCK;
  const MAX_SCALE = 1.0; // never upscale — keep cards at natural size and center any leftover height
  const scale = avail > 0 ? Math.max(1, Math.min(MAX_SCALE, avail / natH)) : 1;
  const scaledH = natH * scale;
  const padTop = avail > scaledH ? Math.round((avail - scaledH) / 2) : 0;

  // Open framed on "you are here": scroll so byte's current node sits centered, not at the
  // far left — the founder shouldn't have to hunt for their next move.
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentX = L.nodes.find((n) => n.task.state === 'current')?.x ?? null;
  useEffect(() => {
    const el = scrollRef.current;
    if (el && currentX != null) {
      el.scrollLeft = Math.max(0, currentX * scale + (CARD_W * scale) / 2 - el.clientWidth / 2);
    }
  }, [currentX, scale]);

  // Scroll affordance: fade the edge (and hint) on whichever side has more map, so later phases
  // (Ship/Launch) are discoverable instead of silently off-screen. Recomputed on scroll and after
  // any relayout/resize that changes the scrollable width.
  const [scrollEdge, setScrollEdge] = useState({ left: false, right: false });
  const syncScrollEdge = () => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollEdge({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  };
  useEffect(() => {
    const raf = requestAnimationFrame(syncScrollEdge);
    return () => cancelAnimationFrame(raf);
  }, [scale, avail, L.width, currentX]);

  // The "advance" moment: when a task improves between renders — a new move becomes `current`,
  // or a `locked` task unlocks because its prerequisites just completed — pulse it once, so
  // finishing one step visibly lights up the next. Detection runs in an effect (the ref is read
  // there, never during render), and the setState is deferred to the next frame so it is never a
  // *synchronous* set-state-in-effect. The pulse itself respects prefers-reduced-motion (see CSS).
  const prevSigRef = useRef<string>('');
  const [pulseIds, setPulseIds] = useState<Set<string>>(new Set());
  const stateSig = L.nodes.map((n) => `${n.task.id}:${n.task.state}`).join('|');
  useEffect(() => {
    const parse = (sig: string): Map<string, string> =>
      new Map(sig ? sig.split('|').map((p) => p.split(':') as [string, string]) : []);
    const prev = parse(prevSigRef.current);
    const now = parse(stateSig);
    prevSigRef.current = stateSig;
    if (prev.size === 0) return; // first render — nothing to celebrate yet
    const open = (s?: string) => s === 'available' || s === 'needsYou';
    const fresh = new Set<string>();
    for (const [id, st] of now) {
      const was = prev.get(id);
      if (!was) continue;
      if ((st === 'current' && was !== 'current') || (open(st) && was === 'locked')) fresh.add(id);
    }
    if (fresh.size === 0) return;
    const raf = requestAnimationFrame(() => setPulseIds(fresh));
    const clear = setTimeout(() => setPulseIds(new Set()), 1500);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(clear);
    };
  }, [stateSig]);

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'relative',
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'var(--sans)',
      }}
    >
      <style>{`.rm-scroll::-webkit-scrollbar{display:none}.rm-node{cursor:pointer;transition:filter .12s,transform .12s}.rm-node:hover{filter:brightness(1.14);transform:translateY(-1px);z-index:10}.rm-node:focus-visible{outline:2px solid var(--accent);outline-offset:2px;z-index:10}.rm-peek{opacity:0;transform:translateY(-3px);transition:opacity .13s ease,transform .13s ease;pointer-events:none;z-index:30}.rm-node:hover .rm-peek,.rm-node:focus-visible .rm-peek{opacity:1;transform:translateY(0)}@media (prefers-reduced-motion:reduce){.rm-peek{transition:opacity .13s ease}}@media (prefers-reduced-motion: no-preference){@keyframes rmPulse{0%{box-shadow:0 0 0 0 color-mix(in srgb, var(--accent) 50%, transparent),0 10px 30px -12px color-mix(in srgb, var(--accent) 60%, transparent)}70%{box-shadow:0 0 0 13px transparent,0 10px 30px -12px color-mix(in srgb, var(--accent) 60%, transparent)}100%{box-shadow:0 0 0 0 transparent,0 10px 30px -12px color-mix(in srgb, var(--accent) 60%, transparent)}}.rm-pulse{animation:rmPulse 1.4s ease-out 1}}`}</style>
      <div
        ref={scrollRef}
        className="rm-scroll"
        onScroll={syncScrollEdge}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          // Hide the scrollbar but keep scrolling (trackpad / shift-wheel).
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        {/* scaled box: its layout size matches the transformed visual so nothing clips */}
        <div
          style={{
            position: 'relative',
            width: L.width * scale,
            height: scaledH,
            marginTop: padTop,
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: L.width,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          >
            {/* phase headers */}
            <div style={{ position: 'relative', height: 28, marginBottom: 6 }}>
              {L.columns.map((c) => (
                <div
                  key={c.key}
                  style={{
                    position: 'absolute',
                    left: c.x,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--sans)',
                      fontSize: 10.5,
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      color: c.current ? CY : TX3,
                      background: c.current ? 'var(--accent-tint)' : 'var(--well)',
                      border: `1px solid ${c.current ? 'var(--accent-line)' : LINE}`,
                      padding: '4px 9px',
                      borderRadius: 7,
                    }}
                  >
                    {c.name}
                  </span>
                  <span style={{ fontFamily: 'var(--sans)', fontSize: 11, color: TX3 }}>
                    {c.done}/{c.total}
                  </span>
                </div>
              ))}
            </div>

            {/* diagram */}
            <div style={{ position: 'relative', width: L.width, height: L.height }}>
              <svg
                width={L.width}
                height={L.height}
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
                aria-hidden="true"
              >
                {L.rootEdges.map((e, i) => (
                  <path
                    key={`r${i}`}
                    d={e.d}
                    fill="none"
                    // stroke via style (not the attribute) so it follows the companion accent.
                    style={{ stroke: 'color-mix(in srgb, var(--accent) 40%, transparent)' }}
                    strokeWidth={1.5}
                    strokeLinejoin="round"
                  />
                ))}
                {nonCrit.map((e, i) => (
                  <path
                    key={`d${i}`}
                    d={e.d}
                    fill="none"
                    // var() isn't valid in the `stroke` attribute — set it via style so the faint
                    // dependency line stays visible on both the cream and charcoal grounds.
                    style={{ stroke: 'var(--t-4)' }}
                    strokeWidth={1.5}
                    strokeDasharray="3 4"
                  />
                ))}
                {crit.map((e, i) => (
                  <path
                    key={`g${i}`}
                    d={e.d}
                    fill="none"
                    style={{ stroke: 'var(--accent)' }}
                    strokeWidth={7}
                    opacity={0.16}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ))}
                {crit.map((e, i) => (
                  <path
                    key={`c${i}`}
                    d={e.d}
                    fill="none"
                    style={{ stroke: 'var(--accent)' }}
                    strokeWidth={2.4}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ))}
              </svg>

              {L.root && (
                <div
                  style={{
                    position: 'absolute',
                    left: L.root.x,
                    top: L.root.y,
                    width: L.root.w,
                    height: L.root.h,
                    borderRadius: 16,
                    background:
                      'linear-gradient(160deg, color-mix(in srgb, var(--accent) 16%, transparent), color-mix(in srgb, var(--accent) 6%, transparent))',
                    border: '1px solid color-mix(in srgb, var(--accent) 45%, transparent)',
                    boxShadow:
                      '0 0 0 1px color-mix(in srgb, var(--accent) 12%, transparent), 0 16px 44px -16px color-mix(in srgb, var(--accent) 50%, transparent)',
                    padding: 15,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    gap: 11,
                  }}
                >
                  <span
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 10,
                      background: `linear-gradient(160deg, ${VIO}, ${CY})`,
                    }}
                  />
                  <span style={{ display: 'block', minWidth: 0, maxWidth: '100%' }}>
                    <span
                      title={projectName}
                      style={{
                        display: 'block',
                        fontFamily: 'var(--sans)',
                        fontSize: 19,
                        fontWeight: 600,
                        color: TX,
                        lineHeight: 1,
                        // Keep the name inside the fixed-width card: clip a long token (e.g. a
                        // long company name) to one line with an ellipsis instead of spilling
                        // out the right edge.
                        maxWidth: '100%',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {projectName}
                    </span>
                    <span
                      style={{
                        display: 'block',
                        marginTop: 5,
                        fontFamily: 'var(--sans)',
                        fontSize: 9.5,
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase',
                        color: VIO,
                      }}
                    >
                      your company
                    </span>
                  </span>
                </div>
              )}

              {L.nodes.map((n) => {
                const t = n.task;
                const blockedTitles = t.dependsOn
                  .map((id) => byId.get(id))
                  .filter((d): d is RoadmapTask => !!d && d.state !== 'done')
                  .map((d) => d.title);
                return (
                  <Node
                    key={t.id}
                    node={n}
                    onClick={onTaskClick ? () => onTaskClick(t) : undefined}
                    pulse={pulseIds.has(t.id)}
                    companionName={companionName}
                    hereLabel={hereLabel}
                    peek={{
                      deptLabel: DEPT_LABEL[t.dept] ?? t.dept,
                      phaseName: phaseName.get(t.phase) ?? '',
                      blockedTitles,
                      unlocksTitles: unlocks.get(t.id) ?? [],
                      flip: n.y + CARD_H + 128 > L.height,
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* edge fades — signal there's more map to either side (later phases scroll off-screen) */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: 48,
          pointerEvents: 'none',
          background: 'linear-gradient(90deg, var(--page), transparent)',
          opacity: scrollEdge.left ? 1 : 0,
          transition: 'opacity .18s ease',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 0,
          width: 56,
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          paddingRight: 6,
          background: 'linear-gradient(270deg, var(--page), transparent)',
          opacity: scrollEdge.right ? 1 : 0,
          transition: 'opacity .18s ease',
        }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: 'var(--surface)',
            border: `1px solid ${LINE}`,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            color: TX3,
            boxShadow: '0 4px 12px -6px rgba(0,0,0,0.4)',
          }}
        >
          ›
        </span>
      </div>
    </div>
  );
}
