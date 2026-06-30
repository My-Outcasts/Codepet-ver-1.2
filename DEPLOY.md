# Deploying Codepet (Vercel)

The app is a Next.js App Router project deployed on Vercel, backed by the shared
Firebase project `devpet-8f4b1` and the Anthropic API.

## 1. Environment variables (Vercel → Project → Settings → Environment Variables)

Set these for **Production** (and Preview, if you use preview deploys). Local dev
reads the same names from `.env.local` (see `.env.example`).

| Variable                                   | Scope      | Secret? | Notes                                              |
| ------------------------------------------ | ---------- | ------- | -------------------------------------------------- |
| `NEXT_PUBLIC_FIREBASE_API_KEY`             | client     | no      | Firebase web config                                |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`         | client     | no      |                                                    |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID`          | client     | no      | also used by Admin verify                          |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`      | client     | no      |                                                    |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | client     | no      |                                                    |
| `NEXT_PUBLIC_FIREBASE_APP_ID`              | client     | no      |                                                    |
| `ANTHROPIC_API_KEY`                        | **server** | **YES** | byte's live task loop. Never prefix `NEXT_PUBLIC`. |
| `NEXT_PUBLIC_SENTRY_DSN`                   | client     | no      | optional — error tracking; app no-ops without it   |
| `FIREBASE_CLIENT_EMAIL`                    | server     | YES     | optional — only for privileged Admin ops           |
| `FIREBASE_PRIVATE_KEY`                     | server     | YES     | optional — paired with the above                   |

> `NEXT_PUBLIC_*` values are embedded in the client bundle (safe — they're public
> identifiers). Everything without that prefix stays server-side only. `.env.local`
> and all real env files are gitignored; only `.env.example` is committed.

## 2. Firebase console (one-time, already done for `devpet-8f4b1`)

- **Authentication → Sign-in method:** Google + Email/Password enabled. ✅
- **Firestore → Rules:** the merged ruleset is deployed (iOS `users`/`feedback`
  - web `companies`). ✅ — see `firestore.rules`; redeploy with
    `firebase deploy --only firestore:rules`.
- **Authentication → Settings → Authorized domains:** add your Vercel production
  domain (e.g. `codepet-v1-2.vercel.app` and any custom domain) so sign-in works
  off `localhost`. ⬅️ **do this before launch.**

## 3. Verify after deploy

1. Sign in (Google + email/password).
2. Complete onboarding → confirm a `companies/{uid}` doc with a `brief` appears in
   Firestore.
3. Run a plain-text or post/email/legal task → byte generates live (route returns
   200; unauthenticated calls return 401).
4. If `NEXT_PUBLIC_SENTRY_DSN` is set, trigger an error and confirm it lands in
   Sentry.

## Known follow-ups

- The `/api/run-task` route verifies Firebase ID tokens but has no per-user rate
  limit — add one if abuse is a concern.
- Sentry source-map upload (the `withSentryConfig` wrapper) is intentionally not
  enabled to avoid Turbopack friction; stack traces are unminified-by-DSN only.
- Deliverable types `site` / `sheet` / `screens` are still authored (not yet
  live-generated).
