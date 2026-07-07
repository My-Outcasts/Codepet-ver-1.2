'use client';
// byte's first-visit briefing on the Overview: a slim card that opens with byte's read
// of THIS project (labeled rows, or a loading/absent state) + a compact "how to read
// this map" key, then hands off to the lit next move. Controlled by OverviewView (which
// owns the phase, localStorage, and the analysis fetch); this component only renders and
// reports intent via onReveal / onDismiss.
import { GUIDE_HEX } from '@/lib/overviewIntro';
import { analysisRows, type ProjectAnalysis } from '@/lib/ai/projectAnalysis';

export default function OverviewIntro({
  analysis,
  analysisLoading,
  onReveal,
  onDismiss,
}: {
  analysis: ProjectAnalysis | null;
  analysisLoading: boolean;
  onReveal: () => void;
  onDismiss: () => void;
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
          width: 380,
          maxWidth: '90vw',
          maxHeight: '86vh',
          overflowY: 'auto',
          padding: '24px 24px 22px',
          background: 'rgba(16,14,28,0.96)',
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
          Here&apos;s my read of your project.
        </div>

        {/* Analysis: loading → ready → absent */}
        {analysisLoading && !analysis && (
          <div
            style={{
              marginTop: 14,
              fontSize: 13,
              lineHeight: 1.6,
              color: 'rgba(245,243,255,.55)',
              fontStyle: 'italic',
            }}
          >
            byte is sizing up your project…
          </div>
        )}
        {analysis && (
          <>
            {/* Synthesized overall verdict — the lead, not a labeled row. */}
            <div
              style={{
                marginTop: 14,
                padding: '13px 14px',
                background: `${GUIDE_HEX}12`,
                border: `1px solid ${GUIDE_HEX}2e`,
                borderRadius: 12,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: '.7px',
                  textTransform: 'uppercase',
                  fontWeight: 700,
                  color: GUIDE_HEX,
                }}
              >
                Overall
              </div>
              <div
                style={{
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: 'rgba(245,243,255,.9)',
                  marginTop: 5,
                }}
              >
                {analysis.overall}
              </div>
            </div>
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 13 }}>
              {analysisRows(analysis).map((r) => (
                <div key={r.label}>
                  <div
                    style={{
                      fontSize: 10,
                      letterSpacing: '.6px',
                      textTransform: 'uppercase',
                      color: `${GUIDE_HEX}bf`,
                    }}
                  >
                    {r.label}
                  </div>
                  <div
                    style={{
                      fontSize: 12.5,
                      lineHeight: 1.5,
                      color: 'rgba(245,243,255,.82)',
                      marginTop: 3,
                    }}
                  >
                    {r.value}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {!analysis && !analysisLoading && (
          <div
            style={{
              fontSize: 13.5,
              lineHeight: 1.6,
              color: 'rgba(245,243,255,.72)',
              marginTop: 12,
            }}
          >
            This whole map is your company. I always keep{' '}
            <b style={{ color: '#F5F3FF' }}>one move lit</b> — the single next thing that matters.
          </div>
        )}

        {/* How to read this map — always shown now */}
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
            How to read this map
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.55, color: 'rgba(245,243,255,.68)' }}>
            The <b style={{ color: '#F5F3FF' }}>center</b> is your whole company; each{' '}
            <b style={{ color: '#F5F3FF' }}>branch</b> is a department I set up; the small dots are
            its tasks. The strip up top is your <b style={{ color: '#F5F3FF' }}>journey stage</b>.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            <LegendRow c={GUIDE_HEX} t="Cyan = your next move (always one, lit)" />
            <LegendRow c="#8B5CF6" t="Purple = I'll do it" />
            <LegendRow c="#FDB022" t="Gold = I draft it, you approve" />
            <LegendRow c="#3B82F6" t="Blue = needs you" />
            <LegendRow c="#34D399" t="Green = done" />
          </div>
        </div>

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
