'use client';
// Auth gate UI. A cinematic, space-forward sign-in: full-bleed cosmic code-art
// behind a refined card, matching the splash/onboarding. Google + email/password.
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
    <div className="signin">
      <div className="signin-card">
        <h1 className="signin-brand">Codepet</h1>
        <p className="signin-sub">
          {mode === 'in' ? 'Sign in to your company.' : 'Create your company.'}
        </p>

        {!configured && (
          <p className="signin-warn">
            Firebase isn&rsquo;t configured yet — add the NEXT_PUBLIC_FIREBASE_* keys to .env.local
            (see .env.example).
          </p>
        )}

        <button
          type="button"
          className="signin-google"
          disabled={busy || !configured}
          onClick={() => run(signInWithGoogle)}
        >
          Continue with Google
        </button>

        <div className="signin-or">
          <span>or</span>
        </div>

        <form onSubmit={onSubmit} className="signin-form">
          {mode === 'up' && (
            <input
              className="signin-input"
              type="text"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
          <input
            className="signin-input"
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="signin-input"
            type="password"
            required
            minLength={6}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit" className="signin-submit" disabled={busy || !configured}>
            {busy ? '…' : mode === 'in' ? 'Sign in' : 'Create company'}
          </button>
        </form>

        {error && <p className="signin-error">{error}</p>}

        <button
          type="button"
          className="signin-toggle"
          onClick={() => {
            setMode(mode === 'in' ? 'up' : 'in');
            setError(null);
          }}
        >
          {mode === 'in' ? 'New here? Create a company' : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}
