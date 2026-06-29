'use client';
import { useApp } from '@/lib/store';
import { DEPTS, type Dept, type Task } from '@/lib/data';
import { taskState } from '@/lib/helpers';

const TTINT: Record<string, string> = { eng: '--blue-tint', mkt: '--clay-tint', ops: '--teal-tint', fin: '--gold-tint', legal: '--violet-tint', design: '--violet-tint', sales: '--accent-tint', support: '--rose-tint' };

interface Row { d: Dept; t: Task; }

// Kanban columns by task state. Order: the two "waiting on you" lanes first
// (your action items), then byte's in-flight work, then completed.
const COLS: Array<{ key: string; label: string; dot: string; test: (x: Row) => boolean }> = [
  { key: 'draft', label: 'Needs approval', dot: 'var(--gold)', test: (x) => !x.t.done && x.t.who === 'draft' },
  { key: 'you', label: 'Needs input', dot: 'var(--blue)', test: (x) => !x.t.done && x.t.who === 'you' },
  { key: 'does', label: 'byte is doing', dot: 'var(--accent)', test: (x) => !x.t.done && x.t.who !== 'draft' && x.t.who !== 'you' },
  { key: 'done', label: 'Done', dot: '#10B981', test: (x) => !!x.t.done },
];

export function TasksView() {
  const { tick, runTask, viewItem, library } = useApp();
  void tick;
  const ALL: Row[] = [];
  DEPTS.forEach((d) => d.tasks.forEach((t) => ALL.push({ d, t })));

  // click a card → open the run/approve flow; a finished card → its deliverable
  const open = ({ d, t }: Row) => {
    if (!t.done) { runTask(t, d, t.who === 'you'); return; }
    const item = t._item || library.find((x) => x.title === t.t);
    if (item) viewItem(item);
  };

  const card = ({ d, t }: Row, key: number) => {
    const st = taskState(t, true);
    return (
      <div className="kb-card" key={key} onClick={() => open({ d, t })} style={{ ['--gtint' as string]: `var(${TTINT[d.k] || '--accent-tint'})` }}>
        <div className="tc-head"><span className="tc-dept">{d.name}</span></div>
        <div className="kb-title">{t.t}</div>
        <div className="tc-foot"><span className={`tstate ${st.cls}`}><i />{st.label}</span></div>
        <div className="tc-glow" />
      </div>
    );
  };

  return (
    <section className="view on" id="v-tasks">
      <div className="vhead"><h1>Tasks</h1><div className="sub">What byte is doing, drafting, or waiting on you for.</div></div>
      <div className="kb-board">
        {COLS.map((c) => {
          const items = ALL.filter(c.test);
          return (
            <div className="kb-col" key={c.key}>
              <div className="kb-colhead">
                <span className="kb-dot" style={{ background: c.dot }} />
                <span className="kb-label">{c.label}</span>
                <span className="kb-count">{items.length}</span>
              </div>
              <div className="kb-list">
                {items.length ? items.map((it, i) => card(it, i)) : <div className="kb-empty">Nothing here</div>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
