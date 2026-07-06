'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/store';
import { PHASES, NODES, byN } from '@/lib/data';
import { eff } from '@/lib/roadmap';
import { StageDrawer, Lock } from './overview/StageDrawer';

export function RoadmapView() {
  const { selStage, drawerOpen, selectStage, tick } = useApp();
  void tick;
  const rmapRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<{ future: string[]; done: string[]; now: string[] }>({
    future: [],
    done: [],
    now: [],
  });
  const [dims, setDims] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const draw = () => {
      const rmap = rmapRef.current;
      if (!rmap) return;
      const cont = rmap.getBoundingClientRect();
      const W = rmap.clientWidth,
        H = rmap.scrollHeight || rmap.clientHeight;
      if (!W) return;
      const pos = (id: number) => {
        const el = rmap.querySelector(`.rstage[data-n="${id}"]`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          l: r.left - cont.left,
          r: r.right - cont.left,
          t: r.top - cont.top,
          b: r.bottom - cont.top,
          cx: (r.left + r.right) / 2 - cont.left,
          cy: (r.top + r.bottom) / 2 - cont.top,
          col: el.closest('.rcol'),
        };
      };
      const lay: { future: string[]; done: string[]; now: string[] } = {
        future: [],
        done: [],
        now: [],
      };
      NODES.forEach((n: any) =>
        n.deps.forEach((dep: number) => {
          const s = pos(dep),
            t = pos(n.n);
          if (!s || !t) return;
          let path: string;
          if (s.col === t.col) {
            path = `M${s.cx},${s.b} L${t.cx},${t.t}`;
          } else {
            const sx = s.r,
              sy = s.cy,
              tx = t.l,
              ty = t.cy,
              midx = (sx + tx) / 2;
            if (Math.abs(sy - ty) < 2) path = `M${sx},${sy} L${tx},${ty}`;
            else {
              const r = Math.min(11, Math.abs(ty - sy) / 2, Math.abs(tx - sx) / 2),
                dir = ty > sy ? 1 : -1;
              path = `M${sx},${sy} L${midx - r},${sy} Q${midx},${sy} ${midx},${sy + dir * r} L${midx},${ty - dir * r} Q${midx},${ty} ${midx + r},${ty} L${tx},${ty}`;
            }
          }
          const es = eff(byN(dep)),
            et = eff(n);
          const kind = et === 'now' ? 'now' : es === 'done' && et === 'done' ? 'done' : 'future';
          lay[kind].push(path);
        }),
      );
      setDims({ w: W, h: H });
      setEdges(lay);
    };
    draw();
    const ro = new ResizeObserver(draw);
    if (rmapRef.current) ro.observe(rmapRef.current);
    window.addEventListener('resize', draw);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', draw);
    };
  }, [tick]);

  return (
    <section
      className="view on"
      id="v-roadmap"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div className="vhead">
        <h1>Roadmap</h1>
        <div className="sub">
          Five phases from idea to growth, marked to where you are today. Tap any stage to open it.
        </div>
      </div>
      <div className="rmap-stage">
        <div className="rmap" ref={rmapRef}>
          <svg
            className="redges"
            viewBox={`0 0 ${dims.w} ${dims.h}`}
            width={dims.w}
            height={dims.h}
          >
            {edges.future.map((d, i) => (
              <path key={`f${i}`} className="re re-future" d={d} />
            ))}
            {edges.done.map((d, i) => (
              <path key={`d${i}`} className="re re-done" d={d} />
            ))}
            {edges.now.map((d, i) => (
              <path key={`n${i}`} className="re re-now" d={d} />
            ))}
          </svg>
          {PHASES.map((p, pi) => {
            const states = p.stages.map((s) => eff(byN(s.n)));
            const done = states.every((x) => x === 'done'),
              now = states.includes('now');
            return (
              <div className={`rcol ${done ? 'done' : now ? 'now' : ''}`} key={pi}>
                <div className="rcol-h">
                  <span className="rdot" />
                  <span className="rnm">{p.name}</span>
                  <span className="rct">{pi + 1}</span>
                </div>
                {p.stages.map((s) => {
                  const n = byN(s.n),
                    e = eff(n);
                  const meta: React.ReactNode =
                    e === 'done' ? (
                      `Done · ${n.a.length} steps`
                    ) : e === 'now' ? (
                      'You are here'
                    ) : e === 'next' ? (
                      `${n.a.length} steps · up next`
                    ) : (
                      <>
                        <Lock /> {n.a.length} steps
                      </>
                    );
                  return (
                    <div
                      className={`rstage ${e}${selStage === n.n && drawerOpen ? ' sel' : ''}`}
                      data-n={n.n}
                      key={n.n}
                      onClick={() => selectStage(n.n)}
                    >
                      <div className="rs-top">
                        <span className="rs-dot">{e === 'done' ? '✓' : ''}</span>
                        <span className="rs-name">{n.name}</span>
                      </div>
                      <div className="rs-meta">{meta}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <StageDrawer />
    </section>
  );
}
