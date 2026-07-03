'use client';
import { useApp } from '@/lib/store';
import { DEPTS, DCOL } from '@/lib/data';

const STATUS: Record<string, { label: string; cls: string }> = {
  attention: { label: 'needs you', cls: 'attn' },
  ready: { label: 'ready', cls: 'ready' },
  idle: { label: 'idle', cls: 'idle' },
};

// Mission-control list — every department as a scannable row: art thumbnail +
// name + status + current task + to-do count. The whole company, readable at a
// glance; click a row to enter.
export function CompanyView() {
  const { openDept, regenerateCompany, tick } = useApp();
  void tick;
  const need = DEPTS.filter((d) => d.status === 'attention').length;

  return (
    <section className="view on" id="v-home">
      <div className="vhead vhead-row">
        <div>
          <h1>Your company</h1>
          <div className="sub">Eight departments · {need} need you today</div>
        </div>
        <button className="replan" onClick={regenerateCompany} title="Regenerate for your stage">
          Re-plan for my stage
        </button>
      </div>
      <div className="deptlist">
        {DEPTS.map((dep) => {
          const col = DCOL[dep.k] || '--accent';
          const later = !!dep.later;
          const task = later
            ? dep.need || 'Comes later as you progress'
            : dep.tasks?.[0]?.t || 'All clear';
          const st = later ? { label: 'later', cls: 'idle' } : STATUS[dep.status] || STATUS.ready;
          return (
            <div
              className={`deptrow${later ? ' later' : ''}`}
              key={dep.k}
              onClick={() => openDept(dep.k)}
              style={{ ['--rc' as string]: `var(${col})` }}
            >
              <div className="dr-img" style={{ backgroundImage: `url('/covers/${dep.k}.png')` }}>
                <span
                  className="dr-badge"
                  style={{ background: `color-mix(in srgb,var(${col}) 34%,#0b0a12)` }}
                >
                  {dep.ab}
                </span>
              </div>
              <div className="dr-body">
                <div className="dr-top">
                  <span className="dr-name">{dep.name}</span>
                  <span className={`dr-status ${st.cls}`}>
                    <i />
                    {st.label}
                  </span>
                </div>
                <div className="dr-task">{task}</div>
              </div>
              <div className="dr-right">
                <span className="dr-count">
                  {later ? (
                    'Later'
                  ) : dep.pend ? (
                    <>
                      <b>{dep.pend}</b> to do
                    </>
                  ) : (
                    'All clear'
                  )}
                </span>
                <span className="dr-open">{later ? '' : 'Open'}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
