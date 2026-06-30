'use client';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/firebase/auth';

export function Topbar() {
  const { user, signOutUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  // Close the menu on a click OUTSIDE it. The listener is attached only while the
  // menu is open and added after the opening click, so it can't immediately
  // re-close the menu (the previous always-on listener did exactly that).
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [open]);

  // Esc cancels the sign-out confirmation.
  useEffect(() => {
    if (!confirming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirming(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirming]);

  // Real identity from the signed-in user (was hardcoded "Mona").
  const name = user?.displayName || user?.email?.split('@')[0] || 'You';
  const email = user?.email ?? '';
  const initial = (name.trim()[0] || 'Y').toUpperCase();

  // Open the confirmation step rather than signing out on the first click.
  const askSignOut = () => {
    setOpen(false);
    setConfirming(true);
  };
  const confirmSignOut = () => {
    setSigningOut(true);
    // On success, onAuthStateChanged unmounts this tree and routes back to the splash.
    signOutUser().catch((err) => {
      console.error('[topbar] sign out failed', err);
      setSigningOut(false);
      setConfirming(false);
    });
  };

  return (
    <>
      <div className="topbar">
        <span className="proj">Codepet</span>
        <button
          ref={ref}
          className={`tb-prof${open ? ' open' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
        >
          <span className="av">{initial}</span>
          {name}
          <svg className="cv" viewBox="0 0 16 16" fill="none">
            <path
              d="M4 6l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div className="tb-menu" onClick={(e) => e.stopPropagation()}>
            <div className="who">
              <b>{name}</b>
              {email && <span>{email}</span>}
            </div>
            <a>Account</a>
            <a>Preferences</a>
            <a onClick={askSignOut}>Sign out</a>
          </div>
        </button>
        <span className="right">
          <button className="tb-ic" title="Search">
            <svg viewBox="0 0 20 20" fill="none">
              <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.7" />
              <path
                d="M14 14l3.5 3.5"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button className="tb-ic dot" title="Notifications">
            <svg viewBox="0 0 20 20" fill="none">
              <path
                d="M6 8.5a4 4 0 0 1 8 0c0 2.8 1.1 4 1.7 4.7H4.3C4.9 12.5 6 11.3 6 8.5Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path
                d="M8.4 16a1.7 1.7 0 0 0 3.2 0"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button className="tb-ic" title="Settings">
            <svg viewBox="0 0 20 20" fill="none">
              <path
                d="M3 6.5h14M3 13.5h14"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <circle
                cx="8"
                cy="6.5"
                r="2.1"
                fill="var(--surface-2)"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <circle
                cx="12.5"
                cy="13.5"
                r="2.1"
                fill="var(--surface-2)"
                stroke="currentColor"
                strokeWidth="1.6"
              />
            </svg>
          </button>
          <span className="upg">Upgrade</span>
        </span>
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
    </>
  );
}
