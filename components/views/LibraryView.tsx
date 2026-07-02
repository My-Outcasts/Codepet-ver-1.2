'use client';
import { useState } from 'react';
import { useApp } from '@/lib/store';
import { LIB_TAG, LIB_BUCKET, LIB_BORDER, LIB_SKIN } from '@/lib/data';

const libBucket = (t: string) => LIB_BUCKET[t] || 'Docs';

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
  const shown = library.filter((x) => activeFilter === 'all' || libBucket(x.type) === activeFilter);

  return (
    <section className="view on" id="v-library">
      <div className="vhead">
        <h1>Library</h1>
        <div className="sub">
          Everything byte has shipped or drafted — approved by you, kept in one place.
        </div>
      </div>
      <div className="lib-bar">
        <div className="lib-filters">
          {library.length > 0 && (
            <>
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
            </>
          )}
        </div>
        <div className="lib-count">
          {library.length ? `${library.length}${library.length === 1 ? ' item' : ' items'}` : ''}
        </div>
      </div>
      <div className="lib-grid">
        {library.length === 0 ? (
          <div className="lib-empty">
            Nothing here yet. When byte finishes a task and you approve it, the deliverable lands
            here — drafts, shipped changes, and checklists in one place.
          </div>
        ) : (
          shown.map((x, i) => {
            const isSite = x.type === 'site';
            const mono = x.type === 'build';
            const sk = LIB_SKIN[x.type] || LIB_SKIN.doc;
            const pc = 'lib-prev' + (isSite ? ' site' : mono ? '' : ' txt-doc');
            const snip = isSite
              ? ''
              : (x.out || '')
                  .split('\n')
                  .filter((l) => l.trim())
                  .slice(0, 6)
                  .join('\n');
            return (
              <div className="lib-card libopen" key={i} onClick={() => viewItem(x)}>
                <div
                  className={pc}
                  style={{
                    ['--tint' as string]: sk.tint,
                    ['--line' as string]: sk.line,
                    ['--ink-h' as string]: sk.ink,
                  }}
                >
                  <span className="lib-tag">{LIB_TAG[x.type]}</span>
                  {isSite && x.site ? (
                    <iframe
                      sandbox="allow-same-origin"
                      scrolling="no"
                      title="thumb"
                      srcDoc={x.site}
                    />
                  ) : (
                    snip && <div className="lib-snip">{snip}</div>
                  )}
                </div>
                <div className="lib-foot">
                  <div className={`di c-${x.k}`}>{x.ab}</div>
                  <div className="lf-t">
                    <div className="lf-title">{x.title}</div>
                    <div className="lf-meta">
                      {x.dept} · {LIB_TAG[x.type]}
                    </div>
                  </div>
                  <span className="lf-open">open</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
