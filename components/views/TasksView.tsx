'use client';
import { useApp } from '@/lib/store';
import { DEPTS, type Dept, type Task } from '@/lib/data';
import { taskState } from '@/lib/helpers';

interface Row {
  d: Dept;
  t: Task;
}

// Kanban columns by the task's real state (via taskState). "byte's queue"
// (draft-not-yet + does) folds into Up next; a produced draft sits in Awaiting.
// Each lane wears its own hue (see .kb-col--* in globals.css) so the board reads
// as four distinct, colorful swimlanes rather than a wall of white.
const COLS: Array<{ key: string; label: string; dot: string; test: (x: Row) => boolean }> = [
  {
    key: 'upnext',
    label: 'Up next',
    dot: 'var(--violet)',
    test: (x) => taskState(x.t, true).cls === 'st-does',
  },
  {
    key: 'awaiting',
    label: 'Awaiting your approval',
    dot: 'var(--gold)',
    test: (x) => taskState(x.t, true).cls === 'st-draft',
  },
  {
    key: 'you',
    label: 'Your move',
    dot: 'var(--blue)',
    test: (x) => taskState(x.t, true).cls === 'st-you',
  },
  { key: 'done', label: 'Done', dot: '#10B981', test: (x) => !!x.t.done },
];

export function TasksView() {
  const { tick, runTask, viewItem, library } = useApp();
  void tick;
  const ALL: Row[] = [];
  DEPTS.forEach((d) => d.tasks.forEach((t) => ALL.push({ d, t })));

  // click a card → open the run/approve flow; a finished card → its deliverable
  const open = ({ d, t }: Row) => {
    if (!t.done) {
      runTask(t, d, t.who === 'you');
      return;
    }
    const item = t._item || library.find((x) => x.title === t.t);
    if (item) viewItem(item);
  };

  const card = ({ d, t }: Row, key: number) => {
    return (
      <div className="kb-card" key={key} onClick={() => open({ d, t })}>
        <div className="kb-dept">{d.name}</div>
        <div className="kb-title">{t.t}</div>
      </div>
    );
  };

  return (
    <section className="view on" id="v-tasks">
      <div className="vhead">
        <h1>Tasks</h1>
        <div className="sub">What byte is doing, drafting, or waiting on you for.</div>
      </div>
      <div className="kb-board">
        {COLS.map((c) => {
          const items = ALL.filter(c.test);
          return (
            <div className={`kb-col kb-col--${c.key}`} key={c.key}>
              <div className="kb-colhead">
                <span className="kb-dot" style={{ background: c.dot }} />
                <span className="kb-label">{c.label}</span>
                <span className="kb-count">{items.length}</span>
              </div>
              <div className="kb-list">
                {items.length ? (
                  items.map((it, i) => card(it, i))
                ) : (
                  <div className="kb-empty">Nothing here</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
