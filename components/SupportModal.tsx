'use client';
import { useState } from 'react';
import { useAuth } from '@/lib/firebase/auth';
import { sendSupportMessage } from '@/lib/firebase/companyData';
import { canSendSupport } from '@/lib/billing';

export function SupportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(false);

  // The modal stays mounted and `open` toggles, so reset each time it opens —
  // otherwise a prior "sent" confirmation would persist and block a second message.
  // Adjusting state during render on a prop change (not in an effect) is the
  // React-recommended pattern for this and avoids a cascading-render effect.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setMsg('');
      setSent(false);
      setError(false);
    }
  }

  if (!open) return null;

  const name = user?.displayName || user?.email?.split('@')[0] || 'You';
  const email = user?.email ?? '';

  const send = async () => {
    if (!canSendSupport(msg) || busy) return;
    setBusy(true);
    setError(false);
    try {
      await sendSupportMessage(msg, name, email);
      setSent(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="so-overlay" onClick={() => !busy && onClose()}>
      <div className="so-modal sup" onClick={(e) => e.stopPropagation()}>
        {sent ? (
          <>
            <h3>Thanks — we got it.</h3>
            <p>We&apos;ll get back to you at {email || 'your email'}.</p>
            <div className="so-acts">
              <button className="so-confirm" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <h3>Contact support</h3>
            <p>Tell us what&apos;s going on and we&apos;ll help.</p>
            <textarea
              className="sup-in"
              autoFocus
              placeholder="What can we help with?"
              value={msg}
              onChange={(e) => {
                setMsg(e.target.value);
                if (error) setError(false);
              }}
            />
            {error && <p className="sup-err">Couldn&apos;t send — try again.</p>}
            <div className="so-acts">
              <button className="so-cancel" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button className="so-confirm" onClick={send} disabled={!canSendSupport(msg) || busy}>
                {busy ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
