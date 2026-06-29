'use client';
import { useApp } from '@/lib/store';
import { DEPTS, type Dept, type Task } from '@/lib/data';
import { taskState } from '@/lib/helpers';

const TTINT: Record<string, string> = { eng: '--blue-tint', mkt: '--clay-tint', ops: '--teal-tint', fin: '--gold-tint', legal: '--violet-tint', design: '--violet-tint', sales: '--accent-tint', support: '--rose-tint' };

interface Row { d: Dept; t: Task; }

export function TasksView() {
  const { tick } = useApp();
  void tick;
  const ALL: Row[] = [];
  DEPTS.forEach((d) => d.tasks.forEach((t) => ALL.push({ d, t })));
  const needsYou = (x: Row) => !x.t.done && (x.t.who === 'you' || x.t.who === 'draft');
  const SECTIONS = [
    { cls: 'you', label: 'Needs you', test: needsYou },
    { cls: '', label: 'byte is doing', test: (x: Row) => !x.t.done && !needsYou(x) },
    { cls: '', label: 'Done', test: (x: Row) => !!x.t.done },
  ];

  const card = ({ d, t }: Row, key: number) => {
    const st = taskState(t, true);
    return (
      <div className="taskcard" key={key} style={{ ['--gtint' as string]: `var(${TTINT[d.k] || '--accent-tint'})` }}>
        <div className="tc-head"><span className="tc-dept">{d.name}</span></div>
        <div className="tc-title">{t.t}</div>
        <div className="tc-foot"><span className={`tstate ${st.cls}`}><i />{st.label}</span></div>
        <div className="tc-glow" />
      </div>
    );
  };

  return (
    <section className="view on" id="v-tasks">
      <div className="vhead"><h1>Tasks</h1><div className="sub">What byte is doing, drafting, or waiting on you for.</div></div>
      <div className="rmwrap" id="taskList" style={{ maxWidth: 'none', paddingBottom: 30 }}>
        {SECTIONS.map((s) => {
          const items = ALL.filter(s.test);
          if (!items.length) return null;
          return (
            <div key={s.label}>
              <div className={`task-sec ${s.cls}`}><span className="ts-t">{s.label}</span><span className="ts-c">{items.length}</span><span className="ts-line" /></div>
              <div className="taskgrid">{items.map((it, i) => card(it, i))}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
