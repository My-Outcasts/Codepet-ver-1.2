'use client';
import { useEffect, useState } from 'react';
import { useApp } from '@/lib/store';
import { useAuth } from '@/lib/firebase/auth';
import { getTrackingState, setTracking } from '@/app/actions/install';

type State = { installed: boolean; enabled: boolean };

export function SettingsView() {
  const { openInstallPrompt } = useApp();
  const { user, signOutUser } = useAuth();
  const name = user?.displayName || user?.email?.split('@')[0] || 'You';
  const email = user?.email ?? '';
  const initial = (name.trim()[0] || 'Y').toUpperCase();
  const isDev = process.env.NODE_ENV === 'development';
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(isDev);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    // The tracking state only feeds the dev-only toggle below — skip the server
    // round-trip for the (prod) users who reach Settings via the account menu.
    if (!isDev) return;
    getTrackingState()
      .then((s) => setState(s as State))
      .finally(() => setLoading(false));
  }, [isDev]);

  // Esc cancels the sign-out confirmation (same behavior as the Topbar menu).
  useEffect(() => {
    if (!confirming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirming(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirming]);

  const toggle = async () => {
    if (!state?.installed || busy) return;
    const next = !state.enabled;
    setBusy(true);
    setState({ ...state, enabled: next }); // optimistic
    try {
      const res = await setTracking(next);
      if (res.ok) setState({ installed: res.installed, enabled: res.enabled });
      else setState({ ...state, enabled: !next }); // revert
    } catch {
      setState({ ...state, enabled: !next }); // revert
    } finally {
      setBusy(false);
    }
  };

  const confirmSignOut = () => {
    setSigningOut(true);
    // On success, onAuthStateChanged unmounts this tree and routes back to the splash.
    signOutUser().catch((err) => {
      console.error('[settings] sign out failed', err);
      setSigningOut(false);
      setConfirming(false);
    });
  };

  return (
    <section className="view on" id="v-settings">
      <div className="vhead">
        <h1>Settings</h1>
        <div className="sub">Your account, and how Codepet runs on this machine.</div>
      </div>

      <div className="set-body">
        <div className="set-sec">
          <h2>Account</h2>
          <p>The identity you use to sign in to Codepet.</p>
        </div>
        <div className="set-card you">
          <div className="set-row">
            <div className="acct">
              <span className="acct-av">{initial}</span>
              <div className="set-txt">
                <b>{name}</b>
                {email && <span>{email}</span>}
              </div>
            </div>
            <button className="set-signout" onClick={() => setConfirming(true)}>
              Sign out
            </button>
          </div>
        </div>

        {isDev && (
          <>
            <div className="set-sec">
              <h2>Session tracking</h2>
              <p>How byte learns from your Claude Code sessions on this machine.</p>
            </div>
            <div className="set-card">
              <div className="set-row">
                <div className="set-txt">
                  <b>Track Claude Code sessions</b>
                  {loading ? (
                    <span>Checking this machine…</span>
                  ) : state?.installed ? (
                    <>
                      <span>
                        byte&apos;s SessionEnd hook reports this machine&apos;s git activity to
                        your Summary.
                      </span>
                      <span className={`set-status${state.enabled ? ' on' : ''}`}>
                        {busy
                          ? 'Saving…'
                          : state.enabled
                            ? 'On — sessions are being reported'
                            : 'Off — reporting is paused (the hook stays installed)'}
                      </span>
                    </>
                  ) : (
                    <span>The tracker is not installed on this machine yet.</span>
                  )}
                </div>
                {!loading &&
                  (state?.installed ? (
                    <button
                      role="switch"
                      aria-checked={state.enabled}
                      aria-label="Track Claude Code sessions"
                      className={`switch${state.enabled ? ' on' : ''}`}
                      disabled={busy}
                      onClick={toggle}
                    >
                      <span className="knob" />
                    </button>
                  ) : (
                    <button className="set-link" onClick={openInstallPrompt}>
                      Install the tracker →
                    </button>
                  ))}
              </div>
            </div>
          </>
        )}
      </div>

      {confirming && (
        <div
          className="so-overlay"
          onClick={() => {
            if (!signingOut) setConfirming(false);
          }}
        >
          <div className="so-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Sign out of Codepet?</h3>
            <p>You&apos;ll need to sign back in to reach your company.</p>
            <div className="so-acts">
              <button
                className="so-cancel"
                onClick={() => setConfirming(false)}
                disabled={signingOut}
              >
                Cancel
              </button>
              <button className="so-confirm" onClick={confirmSignOut} disabled={signingOut}>
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
