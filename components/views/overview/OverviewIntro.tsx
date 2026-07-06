'use client';
// byte's first-visit welcome on the Overview — orients the founder (what this map
// is, how to read the ribbon / the lit next-move / the colors) and sends them to
// their next move. Shown once per browser (localStorage), then never again.
import { useState } from 'react';

const SEEN_KEY = 'codepet:overview-intro-seen';
const GUIDE = '#7DE3FF';

export default function OverviewIntro() {
  // Client-only (the Overview is dynamically imported with ssr:false), so reading
  // localStorage in the initializer is safe — and avoids set-state-in-effect.
  const [show, setShow] = useState(() => {
    try {
      return !localStorage.getItem(SEEN_KEY);
    } catch {
      return false;
    }
  });
  if (!show) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* ignore */
    }
    setShow(false);
  };
  return (
    <div
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
        style={{
          width: 430,
          maxWidth: '88vw',
          padding: '26px 26px 24px',
          background: 'rgba(16,14,28,0.94)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: `1px solid ${GUIDE}40`,
          borderRadius: 18,
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: '1.5px',
            fontWeight: 700,
            color: GUIDE,
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
          This is your company, as a living map.
        </div>
        <div
          style={{ fontSize: 13.5, lineHeight: 1.6, color: 'rgba(245,243,255,.72)', marginTop: 12 }}
        >
          I&apos;m byte — I build your company with you, department by department. Here&apos;s how
          to read your map:
        </div>
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <IntroRow
            c={GUIDE}
            t="The ribbon up top is your journey"
            d="Find → Build → Ship → Launch → Grow. It marks the stage you're in and how far through it you are."
          />
          <IntroRow
            c={GUIDE}
            t="I always light up your next move"
            d="Follow the glowing trail from the center out to the bright node — that's the one thing to do next. Hit Start and I'll take it on."
          />
          <IntroRow
            c="#8B5CF6"
            t="Colors show who's doing what"
            d="Purple = I'll do it · gold = needs your approval · blue = needs you · green = done."
          />
        </div>
        <button
          onClick={dismiss}
          style={{
            marginTop: 22,
            fontFamily: 'inherit',
            fontSize: 13.5,
            fontWeight: 650,
            color: '#0B0616',
            background: GUIDE,
            border: 0,
            borderRadius: 10,
            padding: '10px 26px',
            cursor: 'pointer',
          }}
        >
          Show me my next move
        </button>
      </div>
    </div>
  );
}

function IntroRow({ c, t, d }: { c: string; t: string; d: string }) {
  return (
    <div style={{ display: 'flex', gap: 11 }}>
      <span
        aria-hidden
        style={{
          marginTop: 6,
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: c,
          flex: 'none',
          boxShadow: `0 0 8px ${c}`,
        }}
      />
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#F5F3FF' }}>{t}</div>
        <div
          style={{ fontSize: 12.5, lineHeight: 1.5, color: 'rgba(245,243,255,.6)', marginTop: 2 }}
        >
          {d}
        </div>
      </div>
    </div>
  );
}
