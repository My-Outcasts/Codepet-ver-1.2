// Sentry browser instrumentation (Phase 4). No-ops until NEXT_PUBLIC_SENTRY_DSN
// is set. Next runs this on client startup (instrumentation-client convention).
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

// Instrument App Router client navigations.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
