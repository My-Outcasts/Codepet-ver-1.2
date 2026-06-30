'use client';
// Auth context for Codepet. Tracks the Firebase user, bootstraps their company on
// first sign-in, and exposes Google + email/password sign-in. Consumers gate the
// app on `user`; until Phase 2 the company data still comes from the in-memory
// store, but `companyId` is the handle Phase 2 reads/writes against.
import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { getFirebaseAuth, isFirebaseConfigured } from './client';
import { ensureUserBootstrap } from './company';

interface AuthState {
  user: User | null;
  companyId: string | null;
  /** Initial auth-state resolution in progress. */
  loading: boolean;
  /** True while bootstrapping the company doc after sign-in. */
  bootstrapping: boolean;
  configured: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, name?: string) => Promise<void>;
  signOutUser: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
export const useAuth = (): AuthState => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used within <AuthProvider>');
  return v;
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  // Only "loading" when Firebase is configured and auth state can actually resolve;
  // otherwise we're immediately settled (the UI shows a not-configured notice).
  const [loading, setLoading] = useState(isFirebaseConfigured);
  const [bootstrapping, setBootstrapping] = useState(false);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    const unsub = onAuthStateChanged(getFirebaseAuth(), async (u) => {
      setUser(u);
      if (u) {
        setBootstrapping(true);
        try {
          setCompanyId(await ensureUserBootstrap(u));
        } catch (err) {
          console.error('[auth] company bootstrap failed', err);
        } finally {
          setBootstrapping(false);
        }
      } else {
        setCompanyId(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    await signInWithPopup(getFirebaseAuth(), new GoogleAuthProvider());
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string, name?: string) => {
    const cred = await createUserWithEmailAndPassword(getFirebaseAuth(), email, password);
    if (name) await updateProfile(cred.user, { displayName: name });
  }, []);

  const signOutUser = useCallback(async () => {
    await signOut(getFirebaseAuth());
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      companyId,
      loading,
      bootstrapping,
      configured: isFirebaseConfigured,
      signInWithGoogle,
      signInWithEmail,
      signUpWithEmail,
      signOutUser,
    }),
    [
      user,
      companyId,
      loading,
      bootstrapping,
      signInWithGoogle,
      signInWithEmail,
      signUpWithEmail,
      signOutUser,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
