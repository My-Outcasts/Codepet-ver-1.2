'use client';
import { useEffect, useState } from 'react';
import { useApp } from '@/lib/store';
import { getTrackingState, setTracking } from '@/app/actions/install';

type State = { installed: boolean; enabled: boolean };

// Dev-only screen. The Sidebar entry and AppRoot route are already gated on
// process.env.NODE_ENV === 'development', so this only renders during local dev.
export function SettingsView() {
  const { show } = useApp();
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getTrackingState().then((s) => setState(s as State));
  }, []);

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
        <div className="sub">Developer-only controls for this machine.</div>
      </div>

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
    </section>
  );
}
