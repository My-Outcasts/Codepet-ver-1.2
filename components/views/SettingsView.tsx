'use client';
import { useEffect, useState } from 'react';
import { useApp } from '@/lib/store';
import { useAuth } from '@/lib/firebase/auth';
import { getTrackingState, setTracking } from '@/app/actions/install';

type State = { installed: boolean; enabled: boolean };

export function SettingsView() {
  const { show } = useApp();
  const { user } = useAuth();
  const name = user?.displayName || user?.email?.split('@')[0] || 'You';
  const email = user?.email ?? '';
  const initial = (name.trim()[0] || 'Y').toUpperCase();
  const isDev = process.env.NODE_ENV === 'development';
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // The tracking state only feeds the dev-only toggle below — skip the server
    // round-trip for the (prod) users who reach Settings via the account menu.
    if (!isDev) return;
    getTrackingState().then((s) => setState(s as State));
  }, [isDev]);

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

  return (
    <section className="view on" id="v-settings">
      <div className="vhead">
        <h1>Settings</h1>
        <div className="sub">Your account.</div>
      </div>

      <div className="set-body">
        <div className="set-card you">
          <div className="set-row">
            <div className="acct">
              <span className="acct-av">{initial}</span>
              <div className="set-txt">
                <b>{name}</b>
                {email && <span>{email}</span>}
              </div>
            </div>
          </div>
        </div>

        {isDev && (
          <div className="set-card">
            <div className="set-row">
              <div className="set-txt">
                <b>Track Claude Code sessions</b>
                <span>
                  {state?.installed
                    ? "byte's SessionEnd hook reports this machine's git activity to your Summary. Turn off to pause reporting (the hook stays installed)."
                    : 'The tracker is not installed on this machine yet.'}
                </span>
              </div>
              {state?.installed ? (
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
                <button className="set-link" onClick={() => show('install')}>
                  Install the tracker →
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
