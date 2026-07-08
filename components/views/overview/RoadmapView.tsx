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
import { useEffect, useRef } from 'react';
import { layoutRoadmap, CARD_W, CARD_H, type PositionedNode } from '@/lib/overview/roadmapLayout';
import { ROADMAP_PHASES, DEPT_LABEL, DEPT_COLOR } from '@/lib/overview/roadmapTemplate';
import type { RoadmapPhase, RoadmapState, RoadmapTask } from '@/lib/overview/roadmapModel';

const CY = '#7de3ff';
const VIO = '#8b5cf6';
const TX = '#f5f3ff';
const TX3 = 'rgba(245,243,255,0.40)';
const LINE = 'rgba(245,243,255,0.09)';
const CARD_BG = '#151222';

// State → the node's icon-dot color + optional corner badge.
const DOT: Record<RoadmapState, string> = {
  done: '#34d399',
  current: CY,
  available: CY,
  needsYou: '#3b82f6',
  approve: '#fdb022',
  locked: TX3,
};
const BADGE: Record<RoadmapState, { text: string; fg: string; bg: string; border: string } | null> =
  {
    done: null,
    current: { text: 'Available', fg: '#04030a', bg: CY, border: CY },
    available: {
      text: 'Available',
      fg: CY,
      bg: 'rgba(125,227,255,0.14)',
      border: 'rgba(125,227,255,0.4)',
    },
    needsYou: {
      text: 'Needs you',
      fg: '#3b82f6',
      bg: 'rgba(59,130,246,0.16)',
      border: 'rgba(59,130,246,0.4)',
    },
    approve: {
      text: 'Approve',
      fg: '#fdb022',
      bg: 'rgba(253,176,34,0.16)',
      border: 'rgba(253,176,34,0.4)',
    },
    locked: null,
  };

function Node({ node }: { node: PositionedNode }) {
  const { task } = node;
  const st = task.state;
  const done = st === 'done';
  const current = st === 'current';
  const locked = st === 'locked';
  const badge = BADGE[st];
  return (
    <div
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
          ? 'linear-gradient(180deg, rgba(125,227,255,0.10), rgba(125,227,255,0.02))'
          : done
            ? 'rgba(52,211,153,0.05)'
            : CARD_BG,
        border: `1px solid ${current ? 'rgba(125,227,255,0.6)' : done ? 'rgba(52,211,153,0.22)' : LINE}`,
        boxShadow: current
          ? '0 0 0 1px rgba(125,227,255,0.2), 0 10px 30px -12px rgba(125,227,255,0.6)'
          : 'none',
        opacity: locked ? 0.62 : 1,
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
            background: '#0d0b18',
            border: '1px solid rgba(125,227,255,0.5)',
            borderRadius: 999,
            padding: '3px 9px 3px 4px',
            boxShadow: '0 6px 20px -8px rgba(125,227,255,0.6)',
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
              fontFamily: 'ui-monospace, monospace',
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
      {badge && (
        <span
          style={{
            position: 'absolute',
            top: -8,
            right: 10,
            fontFamily: 'ui-monospace, monospace',
            fontSize: 8.5,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            padding: '2px 7px',
            borderRadius: 6,
            color: badge.fg,
            background: badge.bg,
            border: badge.border === badge.bg ? 'none' : `1px solid ${badge.border}`,
          }}
        >
          {badge.text}
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
            opacity: 0.7,
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
          background: done ? 'rgba(52,211,153,0.14)' : 'rgba(245,243,255,0.06)',
          border: `1px solid ${done ? 'rgba(52,211,153,0.3)' : LINE}`,
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
            display: 'block',
            fontSize: 12.5,
            fontWeight: 600,
            color: TX,
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 130,
          }}
        >
          {task.title}
        </span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            marginTop: 4,
            fontSize: 10,
            color: 'rgba(245,243,255,0.64)',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: DEPT_COLOR[task.dept] ?? TX3,
            }}
          />
          {DEPT_LABEL[task.dept] ?? task.dept}
        </span>
      </span>
    </div>
  );
}

export default function RoadmapView({
  phases = ROADMAP_PHASES,
  tasks,
  projectName = 'Your company',
}: {
  phases?: RoadmapPhase[];
  tasks: RoadmapTask[];
  projectName?: string;
}) {
  const L = layoutRoadmap(phases, tasks);
  const nonCrit = L.edges.filter((e) => !e.critical);
  const crit = L.edges.filter((e) => e.critical);

  // Open framed on "you are here": scroll so byte's current node sits centered, not at the
  // far left — the founder shouldn't have to hunt for their next move.
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentX = L.nodes.find((n) => n.task.state === 'current')?.x ?? null;
  useEffect(() => {
    const el = scrollRef.current;
    if (el && currentX != null) {
      el.scrollLeft = Math.max(0, currentX + CARD_W / 2 - el.clientWidth / 2);
    }
  }, [currentX]);

  return (
    <div
      ref={scrollRef}
      className="rm-scroll"
      style={{
        overflowX: 'auto',
        padding: '6px 0 4px',
        // Hide the scrollbar but keep scrolling (trackpad / shift-wheel).
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
      }}
    >
      <style>{`.rm-scroll::-webkit-scrollbar{display:none}`}</style>
      <div style={{ position: 'relative', width: L.width, minWidth: L.width }}>
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
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: 10.5,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: c.current ? CY : TX3,
                  background: c.current ? 'rgba(125,227,255,0.08)' : 'rgba(245,243,255,0.05)',
                  border: `1px solid ${c.current ? 'rgba(125,227,255,0.4)' : LINE}`,
                  padding: '4px 9px',
                  borderRadius: 7,
                }}
              >
                {c.name}
              </span>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: TX3 }}>
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
                stroke="rgba(139,92,246,0.4)"
                strokeWidth={1.5}
                strokeLinejoin="round"
              />
            ))}
            {nonCrit.map((e, i) => (
              <path
                key={`d${i}`}
                d={e.d}
                fill="none"
                stroke="rgba(245,243,255,0.18)"
                strokeWidth={1.5}
                strokeDasharray="3 4"
              />
            ))}
            {crit.map((e, i) => (
              <path
                key={`g${i}`}
                d={e.d}
                fill="none"
                stroke={CY}
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
                stroke={CY}
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
                  'linear-gradient(160deg, rgba(139,92,246,0.16), rgba(125,227,255,0.06))',
                border: '1px solid rgba(139,92,246,0.45)',
                boxShadow:
                  '0 0 0 1px rgba(139,92,246,0.12), 0 16px 44px -16px rgba(139,92,246,0.5)',
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
              <span>
                <span
                  style={{
                    display: 'block',
                    fontFamily: 'Georgia, serif',
                    fontSize: 19,
                    fontWeight: 600,
                    color: TX,
                    lineHeight: 1,
                  }}
                >
                  {projectName}
                </span>
                <span
                  style={{
                    display: 'block',
                    marginTop: 5,
                    fontFamily: 'ui-monospace, monospace',
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
            <Node key={n.task.id} node={n} />
          ))}
        </div>
      </div>
    </div>
  );
}
