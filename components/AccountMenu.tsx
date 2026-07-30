'use client';
// The account control — avatar + name + dropdown, sitting in the topbar beside the Codepet brand.
// Owns its own menu, the sign-out confirmation, the support modal, and the appearance switch.
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AccountMenu() {
  const { user, signOutUser } = useAuth();
  const { show } = useApp();
  const { pref, setPref } = useTheme();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [support, setSupport] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close the menu on a click outside it — attached only while open, and after the opening
  // click, so it can't immediately re-close.
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

  // A friendly handle for the row: the display name, unless it's missing or is just the raw
  // signup email — then fall back to the email's local part. The full email stays in the dropdown.
  const displayName = user?.displayName?.trim();
  const email = user?.email ?? '';
  const emailLocal = email.split('@')[0];
  const name = displayName && !EMAIL_RE.test(displayName) ? displayName : emailLocal || 'You';
  const initial = (name.trim()[0] || 'Y').toUpperCase();

  const askSignOut = () => {
    setOpen(false);
    setConfirming(true);
  };
  const confirmSignOut = () => {
    setSigningOut(true);
    // On success, onAuthStateChanged unmounts this tree and routes back to the splash.
    signOutUser().catch((err) => {
      console.error('[account] sign out failed', err);
      setSigningOut(false);
      setConfirming(false);
    });
  };

  return (
    <>
      <div className={`acct-wrap${open ? ' open' : ''}`} ref={ref}>
        <button
          className="acct"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="av">{initial}</span>
          <span className="acct-nm">{name}</span>
          <svg className="cv" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M4 6l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div className="tb-menu acct-menu" role="menu" onClick={(e) => e.stopPropagation()}>
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
