'use client';
import { useState } from 'react';
import { useApp } from '@/lib/store';
import { DEPTS, DCOL } from '@/lib/data';
import type { DecisionEntry } from '@/lib/ai/projectModel';

const STATUS: Record<string, { label: string; cls: string }> = {
  attention: { label: 'needs you', cls: 'attn' },
  ready: { label: 'ready', cls: 'ready' },
  idle: { label: 'idle', cls: 'idle' },
};

// One decision byte is holding, as a tinted memory card. View shows the topic + the
// statement + where it came from; the founder can correct a wrong extraction in place
// or remove it. Delete is two-step (no browser dialog) so a stray click can't wipe it.
function MemoryCard({
  decision,
  onSave,
  onDelete,
}: {
  decision: DecisionEntry;
  onSave: (statement: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(decision.statement);
  const [confirming, setConfirming] = useState(false);

  const save = () => {
    const next = draft.trim();
    if (next && next !== decision.statement) onSave(next);
    setEditing(false);
  };
  const cancel = () => {
    setDraft(decision.statement);
    setEditing(false);
  };

  return (
    <div className="mem-card" style={{ ['--mh' as string]: 'var(--violet)' }}>
      <div className="mem-topic">{decision.topic}</div>
      {editing ? (
        <>
          <textarea
            className="mem-edit"
            value={draft}
            autoFocus
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
              if (e.key === 'Escape') cancel();
            }}
          />
          <div className="mem-actions">
            <button className="mem-btn primary" onClick={save}>
              Save
            </button>
            <button className="mem-btn" onClick={cancel}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="mem-stmt">{decision.statement}</div>
          <div className="mem-foot">
            {decision.source ? <span className="mem-src">{decision.source}</span> : <span />}
            {confirming ? (
              <div className="mem-actions">
                <button className="mem-btn danger" onClick={onDelete}>
                  Remove
                </button>
                <button className="mem-btn" onClick={() => setConfirming(false)}>
                  Keep
                </button>
              </div>
            ) : (
              <div className="mem-actions">
                <button
                  className="mem-btn"
                  onClick={() => {
                    setDraft(decision.statement);
                    setEditing(true);
                  }}
                >
                  Edit
                </button>
                <button className="mem-btn" onClick={() => setConfirming(true)}>
                  Remove
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Mission-control list — every department as a scannable row: art thumbnail +
// name + status + current task + to-do count. The whole company, readable at a
// glance; click a row to enter.
export function CompanyView() {
  const { openDept, regenerateCompany, tick, decisions, updateDecision, deleteDecision } = useApp();
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

      <div className="mem-sec">
        <div className="mem-head">
          <h2>What byte remembers</h2>
          <div className="sub">
            Durable decisions byte carries into every task it drafts. Correct anything that’s off.
          </div>
        </div>
        {decisions.length === 0 ? (
          <div className="mem-empty">
            No decisions yet. As you approve work, the lasting choices — pricing, positioning,
            audience — show up here for byte to build on.
          </div>
        ) : (
          <div className="mem-grid">
            {decisions.map((d, i) => (
              <MemoryCard
                key={`${d.topic}-${i}`}
                decision={d}
                onSave={(statement) => updateDecision(i, { statement })}
                onDelete={() => deleteDecision(i)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
