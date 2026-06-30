'use client';
import { useApp } from '@/lib/store';
import { DEPTS, DCOL, type Task, type Dept, type LibItem } from '@/lib/data';
import { taskState } from '@/lib/helpers';
import { Byte } from '../Byte';

function Delivered({ item, onOpen }: { item: LibItem; onOpen: () => void }) {
  const openable = item.type === 'site' || item.type === 'screens' || item.type === 'sheet';
  const openLbl =
    item.type === 'site'
      ? 'Open the site ↗'
      : item.type === 'screens'
        ? 'Tap through ↗'
        : item.type === 'sheet'
          ? 'Open the model ↗'
          : '';
  return (
    <div className={`delivered${item.type === 'site' ? ' site' : ''}`} onClick={onOpen}>
      <div className={`dl-bar ${item.type}`}>
        <span>{item.head}</span>
        <span className="dl-file">{item.file}</span>
      </div>
      {item.type === 'site' && item.site ? (
        <div className="dl-thumb">
          <iframe sandbox="allow-same-origin" scrolling="no" title="thumb" srcDoc={item.site} />
        </div>
      ) : (
        <div className="dl-body">{(item.out || '').split('\n').slice(0, 4).join('\n')}</div>
      )}
      {openable && <span className="dl-open">{openLbl}</span>}
    </div>
  );
}

function TaskCard({ t, dept }: { t: Task; dept: Dept }) {
  const { runTask, viewItem } = useApp();
  if (t.done) {
    return (
      <div className="tk tk-done">
        <div className="tk-top">
          <div style={{ flex: 1 }}>
            <div className="tt">{t.t}</div>
            <div className="td">{t.d}</div>
          </div>
        </div>
        <div className="tk-act">
          <span className="donerow">
            <span className="ok">✓</span> {t.run === 'route' ? 'Shipped' : 'Approved'} · delivered
          </span>
          {t._item && <Delivered item={t._item} onOpen={() => viewItem(t._item as LibItem)} />}
        </div>
      </div>
    );
  }
  const st = taskState(t, true);
  return (
    <div className="tk">
      <div className="tk-top">
        <div style={{ flex: 1 }}>
          <div className="tt">{t.t}</div>
          <div className="td">{t.d}</div>
        </div>
        <span className={`tstate ${st.cls}`}>
          <i />
          {st.label}
        </span>
      </div>
      <div className="tk-act">
        {t.who === 'you' ? (
          <button className="btn ghost" onClick={() => runTask(t, dept, true)}>
            Walk me through it
          </button>
        ) : (
          <button className="btn" onClick={() => runTask(t, dept)}>
            {t.who === 'draft' ? 'Have byte draft it' : 'Have byte do it'}
          </button>
        )}
      </div>
    </div>
  );
}

export function DepartmentDetail() {
  const { deptKey, show, tick } = useApp();
  void tick;
  const d = DEPTS.find((x) => x.k === deptKey);
  if (!d)
    return (
      <section className="view on" id="v-dept">
        <div className="ddet" />
      </section>
    );
  const col = DCOL[d.k] || '--accent';
  const left = d.tasks.filter((t) => !t.done).length;

  return (
    <section className="view on" id="v-dept">
      <div className="ddet" style={{ ['--dc' as string]: `var(${col})` }}>
        <div className="back" onClick={() => show('home')}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M10 4L6 8l4 4"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Company
        </div>
        <div className="dhero2" style={{ backgroundImage: `url('/covers/${d.k}.png')` }}>
          <span
            className="dh-tint"
            style={{
              background: `linear-gradient(180deg,transparent 0%,transparent 36%,color-mix(in srgb,var(${col}) 52%,rgba(20,16,12,.62)) 100%)`,
            }}
          />
          <div className="dh-label">
            <span className={`dh-mono c-${d.k}`}>{d.ab}</span>
            <h2>{d.name}</h2>
          </div>
        </div>
        <div className="dneed">{d.need}</div>
        <div className="byteline">
          <Byte size="s28" />
          <div className="txt">{d.byte}</div>
        </div>
        <div className="tk-h">
          What needs doing · {left} of {d.tasks.length} left
        </div>
        <div id="tks">
          {d.tasks.map((t, i) => (
            <TaskCard key={i} t={t} dept={d} />
          ))}
        </div>
      </div>
    </section>
  );
}
