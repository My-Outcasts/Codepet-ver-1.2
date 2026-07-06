'use client';
// byte's first-visit welcome on the Overview — a slim, value-first card that
// hands off to the lit next move. Controlled by OverviewView (which owns the
// phase + localStorage); this component only renders and reports intent via
// onReveal / onDismiss. When reopened from "? how to read this map", showLegend
// is true and the full color key is appended.
import { GUIDE_HEX } from '@/lib/overviewIntro';

export default function OverviewIntro({
  onReveal,
  onDismiss,
  showLegend,
}: {
  onReveal: () => void;
  onDismiss: () => void;
  showLegend: boolean;
}) {
  return (
    <div
      onClick={onDismiss}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 8,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'rgba(4,3,10,0.55)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 360,
          maxWidth: '88vw',
          padding: '24px 24px 22px',
          background: 'rgba(16,14,28,0.95)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: `1px solid ${GUIDE_HEX}40`,
          borderRadius: 18,
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: '1.5px',
            fontWeight: 700,
            color: GUIDE_HEX,
            textTransform: 'uppercase',
          }}
        >
          byte · your companion
        </div>
        <div
          style={{
            fontSize: 20,
            fontWeight: 650,
            color: '#F7F5FF',
            letterSpacing: '-.3px',
            marginTop: 10,
            lineHeight: 1.25,
          }}
        >
          I&apos;ll build your company with you — one move at a time.
        </div>
        <div style={{ fontSize: 13.5, lineHeight: 1.6, color: 'rgba(245,243,255,.72)', marginTop: 12 }}>
          This whole map is your company. I always keep{' '}
          <b style={{ color: '#F5F3FF' }}>one move lit</b> — the single next thing that matters. Let
          me show you.
        </div>

        {showLegend && (
          <div
            style={{
              marginTop: 16,
              paddingTop: 14,
              borderTop: '1px solid rgba(255,255,255,.08)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div
              style={{
                fontSize: 11,
                letterSpacing: '.5px',
                textTransform: 'uppercase',
                color: 'rgba(245,243,255,.5)',
              }}
            >
              What the colors mean
            </div>
            <LegendRow c={GUIDE_HEX} t="Cyan = your next move (always one, lit)" />
            <LegendRow c="#8B5CF6" t="Purple = I'll do it" />
            <LegendRow c="#FDB022" t="Gold = I draft it, you approve" />
            <LegendRow c="#3B82F6" t="Blue = needs you" />
            <LegendRow c="#34D399" t="Green = done" />
          </div>
        )}

        <button
          onClick={onReveal}
          style={{
            marginTop: 20,
            width: '100%',
            fontFamily: 'inherit',
            fontSize: 13.5,
            fontWeight: 700,
            color: '#0B0616',
            background: GUIDE_HEX,
            border: 0,
            borderRadius: 10,
            padding: '11px 26px',
            cursor: 'pointer',
          }}
        >
          Show me my next move ▸
        </button>
        <div
          style={{ fontSize: 11, color: 'rgba(245,243,255,.4)', textAlign: 'center', marginTop: 9 }}
        >
          I&apos;ll explain the map as we go.
        </div>
      </div>
    </div>
  );
}

function LegendRow({ c, t }: { c: string; t: string }) {
  return (
    <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: c,
          boxShadow: `0 0 8px ${c}`,
          flex: 'none',
        }}
      />
      <div style={{ fontSize: 12.5, color: 'rgba(245,243,255,.72)' }}>{t}</div>
    </div>
  );
}
