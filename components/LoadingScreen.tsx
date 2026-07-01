// Full-screen branded loading state, shown while auth resolves, the company
// bootstraps, or its state hydrates from Firestore. A full-bleed code-art image
// (loading.jpg) with a dark scrim carries the brand — no mascot, just the label —
// so every pre-app moment feels like one continuous cinematic flow.
export function LoadingScreen({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loadscr" role="status" aria-live="polite">
      <div className="loadscr-in">
        <div className="loadscr-label">{label}</div>
      </div>
    </div>
  );
}
