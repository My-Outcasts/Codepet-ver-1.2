// Full-screen branded loading state, shown while auth resolves, the company
// bootstraps, or its state hydrates from Firestore. Reuses the splash/sign-in
// look (splash.jpg full-bleed + dark overlay) so every pre-app moment feels like
// one continuous branded flow instead of a bare cream screen.
export function LoadingScreen({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loadscr" role="status" aria-live="polite">
      <div className="loadscr-in">
        <img className="loadscr-byte" src="/byte.png" alt="" aria-hidden="true" />
        <div className="loadscr-label">{label}</div>
        <div className="loadscr-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      </div>
    </div>
  );
}
