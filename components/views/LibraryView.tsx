'use client';
import { useState } from 'react';
import { useApp } from '@/lib/store';
import { LIB_TAG, LIB_BUCKET, LIB_BORDER, LIB_TC, DEPTS } from '@/lib/data';
import { OutcomePreview } from '@/components/library/OutcomePreview';

const libBucket = (t: string) => LIB_BUCKET[t] || 'Docs';

// A deliverable is "live" once it's deployed or verified in the real world;
// everything else is something byte drafted for you to approve.
const LIVE_TYPES = new Set(['site', 'sheet', 'build']);
const libState = (t: string): 'live' | 'draft' => (LIVE_TYPES.has(t) ? 'live' : 'draft');
const pad2 = (n: number) => String(n).padStart(2, '0');

type LibItem = ReturnType<typeof useApp>['library'][number];

const DEPT_ORDER = DEPTS.map((d) => d.k);

export function LibraryView() {
  const { library, viewItem, tick } = useApp();
  void tick;
  const [filter, setFilter] = useState('all');

  const counts: Record<string, number> = {};
  library.forEach((x) => {
    const b = libBucket(x.type);
    counts[b] = (counts[b] || 0) + 1;
  });
  const buckets = LIB_BORDER.filter((b) => counts[b]);
  const activeFilter = filter !== 'all' && !counts[filter] ? 'all' : filter;
  const liveN = library.filter((x) => libState(x.type) === 'live').length;

  const shown = library.filter((x) => activeFilter === 'all' || libBucket(x.type) === activeFilter);

  // group by department, in the app's canonical DEPTS order (unknown depts last)
  const byDept = new Map<string, LibItem[]>();
  shown.forEach((x) => {
    const key = x.k || 'other';
    if (!byDept.has(key)) byDept.set(key, []);
    byDept.get(key)!.push(x);
  });
  const deptKeys = [
    ...DEPT_ORDER.filter((k) => byDept.has(k)),
    ...[...byDept.keys()].filter((k) => !DEPT_ORDER.includes(k)),
  ];

  const descOf = (x: LibItem) =>
    (x.out || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(' ');

  const Row = ({ x }: { x: LibItem }) => {
    const tc = LIB_TC[x.type] || 'var(--t-3)';
    const desc = descOf(x);
    const live = libState(x.type) === 'live';
    return (
      <div className="lib-tile libopen" onClick={() => viewItem(x)}>
        <OutcomePreview item={x} />
        <div className="lt-info">
          <span className="lt-tag" style={{ color: tc }}>
            {LIB_TAG[x.type]}
          </span>
          <div className="lt-title">{x.title}</div>
          {desc && <div className="lt-desc">{desc}</div>}
          <div className="lt-metarow">
            <span className={`lt-state${live ? ' live' : ''}`}>
              <span className={`lib-pip${live ? '' : ' hollow'}`} />
              {live ? 'Live' : 'Draft'}
            </span>
            <span className="lt-open">open →</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <section className="view on" id="v-library">
      <div className="vhead lib-mast">
        <h1>Library</h1>
        <div className="sub lib-say">
          Everything byte has shipped or drafted — approved by you, kept in one place.
        </div>
        {library.length > 0 && (
          <div className="lib-idx">
            {pad2(library.length)} {library.length === 1 ? 'item' : 'items'}
            {liveN > 0 && <> · {pad2(liveN)} live</>}
            {library.length - liveN > 0 && <> · {pad2(library.length - liveN)} draft</>}
          </div>
        )}
      </div>

      {library.length > 0 && (
        <div className="lib-bar">
          <div className="lib-filters">
            <div
              className={`lib-chip${activeFilter === 'all' ? ' on' : ''}`}
              onClick={() => setFilter('all')}
            >
              All <span className="n">{library.length}</span>
            </div>
            {buckets.map((b) => (
              <div
                key={b}
                className={`lib-chip${activeFilter === b ? ' on' : ''}`}
                onClick={() => setFilter(b)}
              >
                {b} <span className="n">{counts[b]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {library.length === 0 ? (
        <div className="lib-grid">
          <div className="lib-empty">
            Nothing here yet. When byte finishes a task and you approve it, the deliverable lands
            here — drafts, shipped changes, and checklists in one place.
          </div>
        </div>
      ) : (
        deptKeys.map((key) => {
          const items = byDept.get(key)!;
          const dept = DEPTS.find((d) => d.k === key);
          const name = dept?.name || items[0]?.dept || 'Other';
          const ab = dept?.ab || items[0]?.ab || '—';
          return (
            <div className="lib-group" key={key}>
              <div className="lib-ghead">
                <span className={`lib-gav c-${key}`}>{ab}</span>
                {name} <span className="gn">— {items.length}</span>
              </div>
              <div className="lib-grid">
                {items.map((x, i) => (
                  <Row key={i} x={x} />
                ))}
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}
