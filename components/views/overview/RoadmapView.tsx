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
import { useEffect, useRef, useState } from 'react';
import { layoutRoadmap, CARD_W, CARD_H, type PositionedNode } from '@/lib/overview/roadmapLayout';
import { ROADMAP_PHASES } from '@/lib/overview/roadmapTemplate';
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
// what's needed, so the founder reads intent directly instead of decoding a corner badge.
const STATUS: Record<RoadmapState, string> = {
  done: 'Done',
  current: 'Up next',
  available: 'byte can do this',
  needsYou: 'Needs your input',
  approve: 'Needs approval',
  locked: 'Needs earlier steps',
};

function Node({
  node,
  onClick,
  pulse,
}: {
  node: PositionedNode;
  onClick?: () => void;
  pulse?: boolean;
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
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        padding: '0 12px',
        borderRadius: 11,
        background: current
          ? 'linear-gradient(180deg, color-mix(in srgb, var(--accent) 10%, transparent), color-mix(in srgb, var(--accent) 2%, transparent))'
          : done
            ? 'rgba(22,163,74,0.05)'
            : CARD_BG,
        border: `1px solid ${current ? 'color-mix(in srgb, var(--accent) 60%, transparent)' : done ? 'rgba(22,163,74,0.22)' : CARD_BORDER}`,
        boxShadow: current
          ? '0 0 0 1px color-mix(in srgb, var(--accent) 20%, transparent), 0 10px 30px -12px color-mix(in srgb, var(--accent) 60%, transparent)'
          : 'none',
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
            byte is here
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
          {STATUS[st]}
        </span>
      </span>
    </div>
  );
}

export default function RoadmapView({
  phases = ROADMAP_PHASES,
  tasks,
  projectName = 'Your company',
  onTaskClick,
}: {
  phases?: RoadmapPhase[];
  tasks: RoadmapTask[];
  projectName?: string;
  /** Click a task card — the current move starts byte, others open their department. */
  onTaskClick?: (task: RoadmapTask) => void;
}) {
  const L = layoutRoadmap(phases, tasks);
  const nonCrit = L.edges.filter((e) => !e.critical);
  const crit = L.edges.filter((e) => e.critical);

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
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'var(--sans)',
      }}
    >
      <style>{`.rm-scroll::-webkit-scrollbar{display:none}.rm-node{cursor:pointer;transition:filter .12s,transform .12s}.rm-node:hover{filter:brightness(1.14);transform:translateY(-1px)}.rm-node:focus-visible{outline:2px solid var(--accent);outline-offset:2px}@media (prefers-reduced-motion: no-preference){@keyframes rmPulse{0%{box-shadow:0 0 0 0 color-mix(in srgb, var(--accent) 50%, transparent),0 10px 30px -12px color-mix(in srgb, var(--accent) 60%, transparent)}70%{box-shadow:0 0 0 13px transparent,0 10px 30px -12px color-mix(in srgb, var(--accent) 60%, transparent)}100%{box-shadow:0 0 0 0 transparent,0 10px 30px -12px color-mix(in srgb, var(--accent) 60%, transparent)}}.rm-pulse{animation:rmPulse 1.4s ease-out 1}}`}</style>
      <div
        ref={scrollRef}
        className="rm-scroll"
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

              {L.nodes.map((n) => (
                <Node
                  key={n.task.id}
                  node={n}
                  onClick={onTaskClick ? () => onTaskClick(n.task) : undefined}
                  pulse={pulseIds.has(n.task.id)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
