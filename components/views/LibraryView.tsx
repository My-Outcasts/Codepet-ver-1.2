'use client';
import { useState } from 'react';
import { useApp } from '@/lib/store';
import { LIB_TAG, LIB_BUCKET, LIB_BORDER, LIB_SKIN } from '@/lib/data';

const libBucket = (t: string) => LIB_BUCKET[t] || 'Docs';

// A deliverable is "live" once it's deployed or verified in the real world;
// everything else is something byte drafted for you to approve.
const LIVE_TYPES = new Set(['site', 'sheet', 'build']);
const libState = (t: string): 'live' | 'draft' => (LIVE_TYPES.has(t) ? 'live' : 'draft');
const pad2 = (n: number) => String(n).padStart(2, '0');

type LibItem = ReturnType<typeof useApp>['library'][number];

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
  const liveItems = shown.filter((x) => libState(x.type) === 'live');
  const draftItems = shown.filter((x) => libState(x.type) === 'draft');

  const descOf = (x: LibItem) =>
    (x.out || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(' ');

  const Tile = ({ x, live }: { x: LibItem; live: boolean }) => {
    const ink = (LIB_SKIN[x.type] || LIB_SKIN.doc).ink;
    const desc = descOf(x);
    return (
      <div
        className="lib-tile libopen"
        style={{ ['--c' as string]: ink }}
        onClick={() => viewItem(x)}
      >
        <span className={`lt-tag${live ? '' : ' draft'}`}>
          <span className="lib-pip" />
          {LIB_TAG[x.type]}
        </span>
        <div className="lt-title">{x.title}</div>
        {desc && <div className="lt-desc">{desc}</div>}
        <div className="lt-foot">
          <div className={`di c-${x.k}`}>{x.ab}</div>
          <div className="lt-dept">{x.dept}</div>
          <span className="lt-open">{x.type === 'site' ? 'open live' : 'open'}</span>
        </div>
      </div>
    );
  };

  return (
    <section className="view on" id="v-library">
      <div className="vhead lib-mast">
        <div>
          <h1>Library</h1>
          {library.length > 0 && (
            <div className="lib-idx">
              {pad2(library.length)} {library.length === 1 ? 'item' : 'items'}
              {liveN > 0 && <> · {pad2(liveN)} live</>}
              {library.length - liveN > 0 && <> · {pad2(library.length - liveN)} draft</>}
            </div>
          )}
        </div>
        <div className="sub lib-say">
          Everything byte has shipped or drafted — approved by you, kept in one place.
        </div>
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
        <>
          {liveItems.length > 0 && (
            <div className="lib-group">
              <div className="lib-ghead">
                <span className="lib-pip" /> Live <span className="gn">— {liveItems.length}</span>
              </div>
              <div className="lib-grid">
                {liveItems.map((x, i) => (
                  <Tile key={`l${i}`} x={x} live />
                ))}
              </div>
            </div>
          )}
          {draftItems.length > 0 && (
            <div className="lib-group">
              <div className="lib-ghead">
                <span className="lib-pip hollow" /> Drafts{' '}
                <span className="gn">— {draftItems.length}</span>
              </div>
              <div className="lib-grid">
                {draftItems.map((x, i) => (
                  <Tile key={`d${i}`} x={x} live={false} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
