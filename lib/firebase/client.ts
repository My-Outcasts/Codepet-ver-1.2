'use client';
// Firebase client singleton. Initializes the app once (HMR/StrictMode safe via
// getApps()) and exposes Auth + Firestore. All keys are NEXT_PUBLIC_* — these are
// public client identifiers, not secrets; access is gated by Firestore rules.
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// True only when the required public config is present. Lets the UI show a clear
// "not configured" state instead of crashing before .env.local is filled in.
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId,
);

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

function getFirebaseApp(): FirebaseApp {
  if (!isFirebaseConfigured) {
    throw new Error(
      'Firebase is not configured. Set NEXT_PUBLIC_FIREBASE_* in .env.local (see .env.example).',
    );
  }
  if (!app) app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return app;
}

export function getFirebaseAuth(): Auth {
  if (!authInstance) authInstance = getAuth(getFirebaseApp());
  return authInstance;
}

export function getDb(): Firestore {
  if (!dbInstance) dbInstance = getFirestore(getFirebaseApp());
  return dbInstance;
}
