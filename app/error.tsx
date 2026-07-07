'use client';
// App-level error boundary: nothing can take the whole app to a blank "Application error"
// screen — worst case is this contained, recoverable panel.
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'var(--page, #0b0714)',
        color: 'var(--t-1, #F5F3FF)',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 380 }}>
        <div style={{ fontSize: 18, fontWeight: 650 }}>Something went wrong.</div>
        <div style={{ fontSize: 13.5, opacity: 0.7, marginTop: 8, lineHeight: 1.5 }}>
          byte hit an unexpected error. Your work is saved — try again, or reload the page.
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 18 }}>
          <button
            onClick={reset}
            style={{
              fontFamily: 'inherit',
              fontSize: 13.5,
              fontWeight: 600,
              padding: '9px 20px',
              borderRadius: 9,
              border: 0,
              cursor: 'pointer',
              color: '#0B0616',
              background: '#7DE3FF',
            }}
          >
            Try again
          </button>
          <button
            onClick={() => location.reload()}
            style={{
              fontFamily: 'inherit',
              fontSize: 13.5,
              fontWeight: 600,
              padding: '9px 20px',
              borderRadius: 9,
              cursor: 'pointer',
              color: 'inherit',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.2)',
            }}
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}
