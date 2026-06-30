'use client';
// Auth gate UI. Minimalist, on the app's existing tokens. Google + email/password
// per the launch decision. Shown whenever there's no signed-in user.
import { useState, type FormEvent } from 'react';
import { useAuth } from '@/lib/firebase/auth';

type Mode = 'in' | 'up';

export function SignIn() {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail, configured } = useAuth();
  const [mode, setMode] = useState<Mode>('in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error ? e.message.replace(/^Firebase:\s*/, '') : 'Something went wrong',
      );
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    run(() =>
      mode === 'in'
        ? signInWithEmail(email, password)
        : signUpWithEmail(email, password, name || undefined),
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        background: 'var(--page)',
        padding: 24,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 380,
          background: 'var(--surface)',
          border: '1px solid var(--hairline)',
          borderRadius: 16,
          padding: 32,
        }}
      >
        <div
          style={{
            fontFamily: 'Google Sans Flex, sans-serif',
            fontWeight: 600,
            fontSize: 22,
            color: 'var(--ink)',
          }}
        >
          Codepet
        </div>
        <p style={{ marginTop: 6, fontSize: 14, color: 'var(--t-3)' }}>
          {mode === 'in' ? 'Sign in to your company.' : 'Create your company.'}
        </p>

        {!configured && (
          <p style={{ marginTop: 16, fontSize: 13, color: 'var(--clay)' }}>
            Firebase isn’t configured yet — add the NEXT_PUBLIC_FIREBASE_* keys to .env.local (see
            .env.example).
          </p>
        )}

        <button
          type="button"
          disabled={busy || !configured}
          onClick={() => run(signInWithGoogle)}
          style={{
            marginTop: 22,
            width: '100%',
            height: 44,
            borderRadius: 10,
            border: '1px solid var(--hairline)',
            background: 'var(--surface)',
            color: 'var(--ink)',
            fontSize: 14,
            fontWeight: 500,
            cursor: busy || !configured ? 'not-allowed' : 'pointer',
          }}
        >
          Continue with Google
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0' }}>
          <div style={{ flex: 1, height: 1, background: 'var(--hairline)' }} />
          <span style={{ fontSize: 12, color: 'var(--t-4)' }}>or</span>
          <div style={{ flex: 1, height: 1, background: 'var(--hairline)' }} />
        </div>

        <form onSubmit={onSubmit} style={{ display: 'grid', gap: 10 }}>
          {mode === 'up' && (
            <input
              type="text"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
            />
          )}
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
          <button
            type="submit"
            disabled={busy || !configured}
            style={{
              height: 44,
              borderRadius: 10,
              border: 'none',
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: busy || !configured ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? '…' : mode === 'in' ? 'Sign in' : 'Create company'}
          </button>
        </form>

        {error && <p style={{ marginTop: 12, fontSize: 13, color: 'var(--rose)' }}>{error}</p>}

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'in' ? 'up' : 'in');
            setError(null);
          }}
          style={{
            marginTop: 18,
            width: '100%',
            background: 'none',
            border: 'none',
            color: 'var(--t-3)',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          {mode === 'in' ? 'New here? Create a company' : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  height: 44,
  padding: '0 14px',
  borderRadius: 10,
  border: '1px solid var(--hairline)',
  background: 'var(--surface-2)',
  color: 'var(--ink)',
  fontSize: 14,
  outline: 'none',
};
