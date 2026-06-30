'use client';
// Brand splash — the first screen a signed-out visitor sees, before sign-in.
// `onContinue` advances to the sign-in screen (click anywhere or "Let's go").
export function Splash({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="splash" onClick={onContinue}>
      <div className="splash-in">
        <h1 className="splash-title pixel">Codepet</h1>
        <p className="splash-sub">Let&apos;s learn how to run your company with AI.</p>
        <button
          className="splash-btn"
          onClick={(e) => {
            e.stopPropagation();
            onContinue();
          }}
        >
          Let&apos;s go
        </button>
      </div>
      <div className="splash-hint">click anywhere to continue</div>
    </div>
  );
}
