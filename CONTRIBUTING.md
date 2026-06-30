# Contributing to Codepet v1.2

Codepet is a Next.js (App Router) app: a macOS-companion-style product that helps
founders run their company with AI, department by department. It's backed by
**Firebase** (Auth + Firestore) and the **Claude API** (byte's live task loop).

## Quick start

```bash
git clone https://github.com/My-Outcasts/Codepet-ver-1.2.git
cd Codepet-ver-1.2
git checkout main && git pull
git checkout -b your-feature        # branch off main for new work

npm install                         # Node 22+ required
cp .env.example .env.local          # then fill in values (see Env vars)
npm run dev                         # → http://localhost:3000
```

## Env vars

`.env.local` is gitignored — you need your own. Two ways to get the values:

- **With Vercel access (easiest):** `npx vercel link` (pick `codepet-v1-2`), then
  `npx vercel env pull .env.local` — pulls everything automatically.
- **Otherwise:** copy `.env.example` and fill it in. The `NEXT_PUBLIC_FIREBASE_*`
  values are public (ask a maintainer); get your **own** `ANTHROPIC_API_KEY` from
  <https://console.anthropic.com>.

| Variable                      | Needed for                                       |
| ----------------------------- | ------------------------------------------------ |
| `NEXT_PUBLIC_FIREBASE_*` (×6) | Firebase Auth + Firestore (client)               |
| `ANTHROPIC_API_KEY`           | byte's live generation (server-side, **secret**) |
| `NEXT_PUBLIC_SENTRY_DSN`      | optional — error tracking                        |

Full deploy/setup details are in [`DEPLOY.md`](./DEPLOY.md).

## Quality gate (run before every push — CI runs all of these)

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # eslint (rules at error; pre-existing baselined)
npm test              # vitest
npm run build         # next build
npm run format        # prettier --write (or format:check)
```

CI (`.github/workflows/ci.yml`) runs typecheck · lint · format:check · test ·
build on every PR. Keep them green.

## Project layout

```
app/                 App Router entry (layout, page, globals.css, api/run-task)
components/          UI — views/, artifact/ (the run→deliver→approve modal), auth/
lib/
  data.ts           Seed company data + shared types (Dept/Task/LibItem/Env)
  store.tsx         App store (mutate-then-rerender + tick), hydrated from Firestore
  helpers.ts        Pure helpers (artifact typing, build logs)
  analytics.ts      Vendor-agnostic track() seam
  firebase/         client, schema, auth, company, companyData, admin (server)
  ai/runTask.ts     Client → /api/run-task (byte's live generation)
instrumentation*.ts Sentry (DSN-gated)
```

## Architecture notes (read before large changes)

- **Store model:** `lib/store.tsx` mutates the module-level `DEPTS`/`ENV` singletons
  in place and bumps a `tick` to re-render. On sign-in it **hydrates** those from
  Firestore (`loadCompanyData`) and **writes through** on mutations (task approval,
  env toggle). Many views import `DEPTS`/`ENV` directly — don't break that contract.
- **Auth gate:** `AppRoot` requires a signed-in Firebase user. The Firestore data
  model is `users/` + `companies/{uid}/{departments,library}` (see `firebase/schema.ts`
  and `firestore.rules`).
- **byte's task loop:** `app/api/run-task/route.ts` calls Claude (`claude-opus-4-8`,
  adaptive thinking). It verifies the caller's Firebase ID token. Plain-text and
  post/email/legal deliverables are generated live (structured output for the rich
  types); the user's onboarding brief personalizes them.

## Gotchas

- **Kill `next dev` before `npm install` / `npm ci`.** Running Turbopack during an
  install has corrupted `node_modules` and caused git/FS slowness. If the dev server
  500s with a Turbopack write error, `rm -rf .next` and restart.
- **`eslint-suppressions.json`** baselines pre-existing lint violations (the
  mutate-in-place pattern). If you add code in that same pattern and lint errors on
  the overflow, re-baseline with `npx eslint . --suppress-all`. Don't add _new_
  classes of violations.
- **The Firebase project (`devpet-8f4b1`) is shared with the macOS app.** Never
  deploy `firestore.rules` that drops the iOS `users`/`feedback` rules — it's a
  merged ruleset.

## Commits & PRs

- Branch off `main`; open a PR. Keep the quality gate green.
- Conventional-ish commit prefixes (`feat:`, `fix:`, `chore:`, `docs:`).
- Don't commit secrets — only `.env.example` is tracked.
