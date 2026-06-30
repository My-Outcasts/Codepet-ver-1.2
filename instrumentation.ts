// Sentry server/edge instrumentation (Phase 4). No-ops until SENTRY_DSN /
// NEXT_PUBLIC_SENTRY_DSN is set, so the app runs fine without a Sentry project.
import * as Sentry from '@sentry/nextjs';

export async function register() {
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  if (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({ dsn, tracesSampleRate: 0.1 });
  }
}

// Capture errors thrown in App Router server components / route handlers.
export const onRequestError = Sentry.captureRequestError;
