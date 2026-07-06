# Account menu — the necessary items, with real destinations

**Date:** 2026-07-06
**Branch:** `feat/account-menu` (off `origin/main`)
**Status:** approved design

## Problem

The account dropdown (`components/Topbar.tsx`) is bare — it shows the founder's name/email and a
single **Sign out**. A reference menu (Vercel-style: Settings · Domains · Skills · Integrations ·
Referrals · Database · Billing · Docs · Discord · Support · Create new company · Log out) raised
the question of what Codepet actually needs. Most of that is platform boilerplate that doesn't map
to Codepet, and two items (**Skills**, **Integrations**) duplicate the **Environment** view.

This adds the items that are genuinely necessary — each pointing at a **real** destination, never a
dead end.

## Direction (decided)

- **Scope: enrich the menu, single-company.** Items: **Settings · Billing & Usage · Support · Log
  out**. Everything else is out (see Non-goals).
- **Real where it's cheap and data-backed, link/modal where it isn't.**
- **Docs: deferred** (no docs URL exists; a dead link is worse than none).
- **Multi-company (a company switcher + "Create new company"): deferred** — real data-model work,
  not a menu item.

## Non-goals

- **No Domains / Database** — Vercel/hosting concepts Codepet doesn't have.
- **No Skills / Integrations menu items** — those live in the **Environment** view; don't duplicate.
- **No Referrals / Discord / Keyboard Shortcuts** — post-beta growth/polish.
- **No real billing (Stripe/checkout).** The Upgrade CTA is an honest "coming soon", not a fake
  checkout. Usage display is real; paid tiers are not built.
- **No Docs page, no multi-company.**
- Nothing in Giang's Build Coach surface.

## Global constraints

- **No dead ends.** Every menu item lands on something real (a view, a modal, or an honest
  "coming soon"), consistent with the product's own rule.
- **Minimalist / functional icons only** (per the design north-star) — Codepet's light style, not
  the dark Vercel look.
- **UI + one client Firestore read (usage) + one write (support)** — no server changes.
- **Reuse existing rails:** navigate via the store's `show(view)`; Support reuses the existing
  Firestore `feedback` write path; Log out keeps its confirm flow.

## Components

### 1. The menu (`components/Topbar.tsx`)

Restructure the `tb-menu` dropdown from `{ who, Sign out }` into a grouped menu:

```
[ who: name + email ]
──────────────
⚙  Settings           → show('settings')
▤  Billing & Usage    → show('billing')
⛑  Support            → open the Support modal
──────────────
⤴  Log out            → existing confirm-then-sign-out
```

Rows navigate via the existing `show(view)` (the dropdown closes on select). The topbar's dead
**"Upgrade"** span is wired to `show('billing')` too (so it stops being a no-op). Icons are minimal.

### 2. Settings — make the dev-only view real (`components/views/SettingsView.tsx`)

`SettingsView` is currently a `NODE_ENV==='development'`-gated debug screen (one "track sessions"
toggle). Give it a **real, small Account section** shown to everyone — the founder's **name, email,
and avatar initial** (read from `useAuth()`), plus the app version. Keep the existing dev toggle
below it, still behind the `development` gate. Make the **route** reachable (the `'settings'` view
renders for all users; only the dev content stays gated). Honest and minimal — a real home, not a
padded page.

### 3. Billing & Usage — real, data-backed (`components/views/BillingView.tsx`, new)

A new `'billing'` view. `BillingView`:

- Reads today's usage doc `companies/{uid}/usage/<yyyy-mm-dd>` (field `n`) via the client Firestore
  SDK (owner-readable), and the limit from `DEFAULT_DAILY_LIMIT` (constant in `lib/ai/rateLimit.ts`).
- Renders **Today's usage** — _"You've used N of LIMIT runs · resets at midnight"_ with a small
  meter, and **Plan** — _Free (beta)_ with an **Upgrade** CTA that opens an honest _"Pro is coming —
  we'll let you know"_ state (no checkout).
- Loading/empty: no usage doc yet → "0 of LIMIT". Read failure → a quiet "couldn't load usage right
  now" (never blocks the page).

A tiny pure helper `usageMeter(n, limit): { used, limit, pct, label }` (clamped) is unit-tested.

### 4. Support (new `components/SupportModal.tsx`, opened from the menu)

The **Support** menu item opens a modal: a short **message** field (with name/email prefilled from
`useAuth()`), a **Send** button, and a confirmation on success. On send it writes a record to the
existing Firestore **`feedback`** collection (same path/shape the feedback toast uses — one added
`kind: 'support'` field). Failure → an inline "couldn't send — try again" (keeps the text). No
mailto, no dead link.

## Data flow

```
Topbar avatar → dropdown
  Settings  → show('settings')  → SettingsView (Account section + dev toggle gated)
  Billing   → show('billing')   → BillingView reads usage/<today>.n + DEFAULT_DAILY_LIMIT → meter + Upgrade(coming-soon)
  Support   → SupportModal → write { message, name, email, kind:'support', ts } to Firestore `feedback` → confirm
  Log out   → existing confirm → signOutUser()
  (topbar "Upgrade" span → show('billing'))
```

## Error handling / robustness

- **No usage doc yet:** treat as `n = 0` → "0 of LIMIT". No error.
- **Usage read fails:** show a quiet fallback line; the rest of the Billing page still renders.
- **Support send fails:** inline retry message; the typed message is preserved.
- **Signed-out / missing user:** the menu only renders inside the authed app, but Account/Support
  guard against a null `user` (fall back to "You" / empty email).
- **Dev toggle:** stays behind `NODE_ENV==='development'` so it never shows in prod.

## Testing

- **Unit (pure):** `usageMeter(n, limit)` (0 → "0 of LIMIT", clamps over-limit, pct rounding); the
  support-form validation (empty message disables Send; trims whitespace).
- **Manual on the Vercel PR preview** (not `next dev`): open the avatar menu → Settings shows the
  Account section (dev toggle hidden in prod) → Billing shows today's usage vs the limit + the
  coming-soon Upgrade → Support sends a message (record lands in Firestore `feedback`) → Log out
  still confirms → the topbar "Upgrade" now opens Billing.

## Ship

Built in an isolated worktree off `origin/main`; verify on the Vercel PR preview; PR → merge so it
reaches prod (committed ≠ merged ≠ deployed).
