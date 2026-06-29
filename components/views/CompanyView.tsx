'use client';
import { useApp } from '@/lib/store';
import { DEPTS, DCOL } from '@/lib/data';

export function CompanyView() {
  const { openDept, tick } = useApp();
  void tick;
  const need = DEPTS.filter((d) => d.status === 'attention').length;

  return (
    <section className="view on" id="v-home">
      <div className="vhead">
        <h1>Your company</h1>
        <div className="sub">Eight departments · {need} need you today</div>
      </div>
      <div className="deptgrid">
        {DEPTS.map((dep) => {
          const col = DCOL[dep.k] || '--accent';
          const task = dep.tasks?.[0]?.t || 'All clear';
          const attn = dep.status === 'attention';
          return (
            <div className="deptcard" key={dep.k} onClick={() => openDept(dep.k)}>
              <div className="dc-cover" style={{ backgroundImage: `url('/covers/${dep.k}.png')` }}>
                <span className="dc-tint" style={{ background: `linear-gradient(180deg,transparent 45%,color-mix(in srgb,var(${col}) 30%,transparent))` }} />
                {attn && <span className="dc-badge">needs you</span>}
              </div>
              <div className="dc-panel">
                <div className="dc-task">{task}</div>
                <div className="dc-foot">
                  {dep.pend ? <><span className="dc-count">{dep.pend}</span> to do</> : 'All clear'}
                </div>
              </div>
              <div className="dc-tab">
                <svg className="dc-tabsvg" viewBox="0 0 200 60" width="200" height="60" preserveAspectRatio="none">
                  <path d="M0,14 A14 14 0 0 1 14,0 L146,0 A14 14 0 0 1 160,14 L160,26 A20 20 0 0 0 180,46 L200,46 L200,60 L0,60 Z" fill="var(--surface)" />
                </svg>
                <span className="dc-mono" style={{ background: `color-mix(in srgb,var(${col}) 16%,white)`, color: `var(${col})` }}>{dep.ab}</span>
                <span className="dc-tabname">{dep.name}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
