'use client';
import { useRef } from 'react';
import { useApp } from '@/lib/store';
import { DEPTS, DCOL } from '@/lib/data';

// "Living world" panorama — the departments' landscapes sit edge-to-edge as one
// continuous, horizontally-scrollable world. Each region carries its status,
// current task and to-do count; click a region to enter that department.
export function CompanyView() {
  const { openDept, tick } = useApp();
  void tick;
  const need = DEPTS.filter((d) => d.status === 'attention').length;
  const railRef = useRef<HTMLDivElement>(null);

  const nudge = (dir: number) => {
    const el = railRef.current; if (!el) return;
    el.scrollBy({ left: dir * Math.min(el.clientWidth * 0.7, 760), behavior: 'smooth' });
  };
  // let a vertical wheel pan the world horizontally (trackpads pan natively)
  const onWheel = (e: React.WheelEvent) => {
    const el = railRef.current; if (!el) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY;
  };

  return (
    <section className="view on" id="v-home">
      <div className="vhead">
        <h1>Your company</h1>
        <div className="sub">Eight departments · {need} need you today — scroll across your world</div>
      </div>
      <div className="world-wrap">
        <button className="world-nav left" aria-label="Scroll left" onClick={() => nudge(-1)}>‹</button>
        <div className="world" ref={railRef} onWheel={onWheel}>
          {DEPTS.map((dep) => {
            const col = DCOL[dep.k] || '--accent';
            const task = dep.tasks?.[0]?.t || 'All clear';
            const attn = dep.status === 'attention';
            return (
              <div
                className="land"
                key={dep.k}
                onClick={() => openDept(dep.k)}
                style={{ backgroundImage: `url('/covers/${dep.k}.png')`, ['--lc' as string]: `var(${col})` }}
              >
                <span className="land-scrim" />
                {attn && <span className="land-flag"><i />needs you</span>}
                <div className="land-info">
                  <div className="land-head">
                    <span className="land-mono" style={{ background: `color-mix(in srgb,var(${col}) 30%,#0b0a12)`, borderColor: `color-mix(in srgb,var(${col}) 55%,transparent)` }}>{dep.ab}</span>
                    <span className="land-name">{dep.name}</span>
                  </div>
                  <div className="land-task">{task}</div>
                  <div className="land-foot">
                    <span className="land-count">{dep.pend ? `${dep.pend} to do` : 'All clear'}</span>
                    <span className="land-enter">Enter</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <button className="world-nav right" aria-label="Scroll right" onClick={() => nudge(1)}>›</button>
      </div>
    </section>
  );
}
