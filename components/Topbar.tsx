'use client';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/firebase/auth';
import { useApp } from '@/lib/store';
import { useTheme, type ThemePref } from '@/lib/theme';
import { SupportModal } from './SupportModal';

const THEME_OPTS: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function Topbar() {
  const { user, signOutUser } = useAuth();
  const { show, installed, openInstallPrompt } = useApp();
  const { pref, setPref } = useTheme();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [support, setSupport] = useState(false);
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
            <div className="tb-sep" />
            <a
              onClick={() => {
                setOpen(false);
                show('settings');
              }}
            >
              Settings
            </a>
            <a
              onClick={() => {
                setOpen(false);
                show('billing');
              }}
            >
              Billing &amp; Usage
            </a>
            <a
              onClick={() => {
                setOpen(false);
                setSupport(true);
              }}
            >
              Support
            </a>
            <div className="tb-sep" />
            <div className="tb-theme">
              <span className="tb-theme-lbl">Appearance</span>
              <div className="tb-seg" role="group" aria-label="Appearance">
                {THEME_OPTS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`tb-seg-opt${pref === opt.value ? ' on' : ''}`}
                    aria-pressed={pref === opt.value}
                    onClick={() => setPref(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="tb-sep" />
            <a onClick={askSignOut}>Log out</a>
          </div>
        </button>
        <span className="right">
          {/* Install-later path for the one-time popup: stays until the toolkit
              is actually installed, then disappears. */}
          {!installed && (
            <button
              className="tb-install"
              onClick={() => {
                setOpen(false);
                openInstallPrompt();
              }}
            >
              <span className="tb-install-dot" />⚡ Wake byte up
            </button>
          )}
          <button
            className="upg"
            onClick={() => {
              setOpen(false);
              show('billing');
            }}
          >
            Upgrade
          </button>
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
      <SupportModal open={support} onClose={() => setSupport(false)} />
    </>
  );
}
