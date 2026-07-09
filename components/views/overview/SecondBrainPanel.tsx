'use client';
// The Second Brain right rail (Chitti-style), fed entirely by real Codepet data: ledger category
// counts, the active model, byte's next move, build/usage stats, and per-department topic counts.
// No capture sources, no voice — just what the founder's own work produces.
import type { LedgerEvent } from '@/lib/firebase/schema';
import type { NextStep } from '@/lib/ai/nextStep';
import type { TrackingSummary } from '@/lib/tracking';
import { DEPTS } from '@/lib/data';
import { companionById } from '@/lib/companions';
import { ledgerCounts, topicCounts } from '@/lib/overview/secondBrainStats';

const MODEL_LABEL = 'claude-opus-4-8';

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'rgba(245,243,255,.4)',
          marginBottom: 7,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | number }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 8,
        fontSize: 12.5,
        padding: '3px 0',
        color: 'rgba(245,243,255,.82)',
      }}
    >
      <span>{k}</span>
      <span style={{ color: '#7DE3FF', fontWeight: 600 }}>{v}</span>
    </div>
  );
}

export default function SecondBrainPanel({
  events,
  nextStep,
  tracking,
  companionId,
  onTopic,
}: {
  events: LedgerEvent[];
  nextStep: NextStep | null;
  tracking: TrackingSummary;
  companionId: string;
  onTopic: (deptK: string) => void;
}) {
  const counts = ledgerCounts(events);
  const topics = topicCounts(
    events,
    DEPTS.map((d) => ({ k: d.k, name: d.name })),
  );
  const companion = companionById(companionId);
  const nextDept = nextStep ? DEPTS.find((d) => d.k === nextStep.deptK)?.name : null;

  const usage: [string, number][] = [
    ['Build sessions', tracking.sessions],
    ['Commits', tracking.commits],
    ['PRs', tracking.prs],
    ['Lines changed', tracking.linesChanged],
    ['Hours saved', tracking.hoursSaved],
  ];

  return (
    <div
      style={{
        height: '100%',
        overflowY: 'auto',
        padding: 14,
        background: 'rgba(12,10,22,0.92)',
        border: '1px solid rgba(255,255,255,0.09)',
        borderRadius: 14,
        fontFamily: 'inherit',
      }}
    >
      <Section label="Status">
        <Row k="Deliverables" v={counts.deliverables} />
        <Row k="Decisions" v={counts.decisions} />
        <Row k="Milestones" v={counts.milestones} />
        <Row k="Build sessions" v={counts.sessions} />
      </Section>

      <Section label="Brain">
        <Row k="Model" v={MODEL_LABEL} />
        <Row k="Companion" v={companion.name} />
      </Section>

      <Section label="Do this next">
        {nextStep ? (
          <button
            onClick={() => onTopic(nextStep.deptK)}
            style={{
              textAlign: 'left',
              width: '100%',
              padding: '8px 10px',
              borderRadius: 9,
              border: '1px solid rgba(125,227,255,0.3)',
              background: 'rgba(125,227,255,0.08)',
              color: '#F5F3FF',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{nextStep.taskTitle}</div>
            <div style={{ fontSize: 11, color: 'rgba(245,243,255,.5)', marginTop: 2 }}>
              {nextDept ?? nextStep.deptK}
            </div>
          </button>
        ) : (
          <div style={{ fontSize: 12, color: 'rgba(245,243,255,.4)' }}>You&apos;re all caught up.</div>
        )}
      </Section>

      <Section label="Usage">
        {usage.filter(([, v]) => v > 0).length === 0 ? (
          <div style={{ fontSize: 12, color: 'rgba(245,243,255,.4)' }}>No activity yet.</div>
        ) : (
          usage.filter(([, v]) => v > 0).map(([k, v]) => <Row key={k} k={k} v={v} />)
        )}
      </Section>

      <Section label="Topics">
        {topics.length === 0 ? (
          <div style={{ fontSize: 12, color: 'rgba(245,243,255,.4)' }}>Nothing yet.</div>
        ) : (
          topics.map((t) => (
            <button
              key={t.deptK}
              onClick={() => onTopic(t.deptK)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                width: '100%',
                gap: 8,
                fontSize: 12.5,
                padding: '5px 8px',
                marginBottom: 3,
                borderRadius: 8,
                border: '1px solid transparent',
                background: 'rgba(255,255,255,0.02)',
                color: 'rgba(245,243,255,.85)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                textAlign: 'left',
              }}
            >
              <span>{t.name}</span>
              <span style={{ color: '#7DE3FF', fontWeight: 600 }}>{t.count}</span>
            </button>
          ))
        )}
      </Section>
    </div>
  );
}
