'use client';
import { useApp } from '@/lib/store';
import { DEPTS, DCOL } from '@/lib/data';

// "Living world" accordion — all eight departments' landscapes share the width
// as slim panels so the whole company is visible at once; hovering a region
// expands it to reveal its scene, current task and to-do count. Click to enter.
export function CompanyView() {
  const { openDept, tick } = useApp();
  void tick;
  const need = DEPTS.filter((d) => d.status === 'attention').length;

  return (
    <section className="view on" id="v-home">
      <div className="vhead">
        <h1>Your company</h1>
        <div className="sub">Eight departments · {need} need you today — hover a region to look closer</div>
      </div>
      <div className="world-wrap">
        <div className="world">
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
                {attn && <span className="land-flag"><i /><span className="lf-txt">needs you</span></span>}
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
      </div>
    </section>
  );
}
