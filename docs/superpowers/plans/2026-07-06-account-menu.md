# Account Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the bare account dropdown (name + Sign out) into a clean, grouped menu — **Settings · Billing & Usage · Support · Log out** — each landing on a real destination.

**Architecture:** The Topbar dropdown navigates via the store's existing `show(view)`. Settings gets a real Account section (dev toggle stays dev-gated); a new Billing & Usage view reads today's usage doc from Firestore + the default limit; Support opens a modal that writes to the existing Firestore `feedback` collection. Pure bits (usage math, form validation) are unit-tested.

**Tech Stack:** Next.js 16 App Router, React, TypeScript, Firebase/Firestore (client SDK), Vitest (`*.test.ts`, node env).

## Global Constraints

_Every task's requirements implicitly include this section. Copy verbatim into each reviewer dispatch._

- **No dead ends:** every menu item lands on a real view / modal / honest "coming soon" — never a blank page or `#` link.
- **No real billing:** the Upgrade CTA is an honest "Pro is coming — we'll let you know" state, NOT a checkout. Usage display is real; paid tiers are not built.
- **Docs and multi-company are OUT** of this feature.
- **Minimal, functional icons only** (design north-star) — Codepet's light style.
- **UI + one client Firestore read (usage) + one write (support)** — no server route changes.
- **Reuse existing rails:** navigate via `show(view)`; Firestore access lives in `lib/firebase/companyData.ts` (which already imports `getDb`/`doc`/`getDoc`/`addDoc`); Log out keeps its confirm flow.
- **Known dependency (flag, don't fix here):** writing to the Firestore `feedback` collection may require a create rule in the Firebase console (noted as an open item elsewhere). Support handles a failed write gracefully; the rule is an ops task, not code.
- **Do NOT touch Giang's Build Coach files** (`BuildCoachView`, `InstallView`, `SummaryView`, `app/api/track*`, `app/api/build-plan`, `app/actions/install.ts` beyond reading `getTrackingState`/`setTracking` already used, installer core, `toolkit/hooks`). Ours: `lib/billing.ts`, `lib/firebase/companyData.ts`, `components/Topbar.tsx`, `components/views/SettingsView.tsx`, `components/views/BillingView.tsx`, `components/SupportModal.tsx`, `components/AppRoot.tsx`, `lib/store.tsx` (View type), `app/globals.css`.
- **Constants:** `DEFAULT_DAILY_LIMIT = 30` and `dayKey(d)` are in `lib/ai/rateLimit.ts`. Usage doc path (client): `companies/{companyId}/usage/{dayKey(now)}`, field `n`.
- **Worktree gotchas:** whole-repo `eslint .` HANGS (symlinked node_modules) → scoped `npx eslint <files>`. Run `npm run format:check` before the final commit (CI `verify` gates it whole-repo).

---

## File Structure

**Create:**
- `lib/billing.ts` — pure `usageMeter` + `canSendSupport` helpers.
- `lib/billing.test.ts` — their unit tests.
- `components/views/BillingView.tsx` — the Billing & Usage view.
- `components/SupportModal.tsx` — the Support message modal.

**Modify:**
- `lib/firebase/companyData.ts` — `loadTodayUsage(companyId)` + `sendSupportMessage(...)`.
- `lib/store.tsx` — add `'billing'` to the `View` type.
- `components/AppRoot.tsx` — route `'billing'` → `BillingView`.
- `components/views/SettingsView.tsx` — real Account section; dev toggle gated.
- `components/Topbar.tsx` — the grouped menu + Support modal + wire Upgrade → Billing.
- `app/globals.css` — menu, billing, settings-account, support-modal styles.

---

### Task 1: Pure helpers — `lib/billing.ts`

**Files:**
- Create: `lib/billing.ts`
- Test: `lib/billing.test.ts`

**Interfaces:**
- Produces:
  - `usageMeter(n: number, limit: number): { used: number; limit: number; pct: number; label: string }` — clamps `used` to `[0, limit]`, `pct` = round(used/limit\*100) clamped `[0,100]`, `label` = `"N of LIMIT runs"`.
  - `canSendSupport(message: string): boolean` — true iff the trimmed message is non-empty.

- [ ] **Step 1: Write the failing test**

Create `lib/billing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { usageMeter, canSendSupport } from './billing';

describe('usageMeter', () => {
  it('computes used / pct / label', () => {
    expect(usageMeter(12, 30)).toEqual({ used: 12, limit: 30, pct: 40, label: '12 of 30 runs' });
    expect(usageMeter(0, 30)).toEqual({ used: 0, limit: 30, pct: 0, label: '0 of 30 runs' });
  });
  it('clamps over-limit and negatives', () => {
    expect(usageMeter(45, 30).used).toBe(30);
    expect(usageMeter(45, 30).pct).toBe(100);
    expect(usageMeter(-3, 30).used).toBe(0);
  });
  it('handles a zero/invalid limit without NaN', () => {
    expect(usageMeter(5, 0).pct).toBe(0);
  });
});

describe('canSendSupport', () => {
  it('requires a non-empty trimmed message', () => {
    expect(canSendSupport('')).toBe(false);
    expect(canSendSupport('   ')).toBe(false);
    expect(canSendSupport('help')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/billing.test.ts`
Expected: FAIL — cannot resolve `./billing`.

- [ ] **Step 3: Write the implementation**

Create `lib/billing.ts`:

```ts
// Pure helpers for the Billing & Usage view and the Support modal.

export function usageMeter(
  n: number,
  limit: number,
): { used: number; limit: number; pct: number; label: string } {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 0;
  const raw = Number.isFinite(n) && n > 0 ? n : 0;
  const used = safeLimit ? Math.min(raw, safeLimit) : raw;
  const pct = safeLimit ? Math.min(100, Math.round((used / safeLimit) * 100)) : 0;
  return { used, limit: safeLimit, pct, label: `${used} of ${safeLimit} runs` };
}

// The Support message is sendable only when it has real content.
export function canSendSupport(message: string): boolean {
  return message.trim().length > 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/billing.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/billing.ts lib/billing.test.ts
git commit -m "feat(billing): pure usageMeter + canSendSupport helpers"
```

---

### Task 2: Billing & Usage view + route

**Files:**
- Modify: `lib/firebase/companyData.ts` (add `loadTodayUsage`; ensure `collection` not needed here)
- Modify: `lib/store.tsx` (`View` type ~line 93 — add `'billing'`)
- Create: `components/views/BillingView.tsx`
- Modify: `components/AppRoot.tsx` (route `'billing'` in the view ternary ~line 71)
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `usageMeter` (Task 1); `DEFAULT_DAILY_LIMIT`, `dayKey` (`lib/ai/rateLimit.ts`); `getDb`/`doc`/`getDoc` (already in `companyData.ts`).
- Produces: `loadTodayUsage(companyId: string): Promise<number>`; the `'billing'` view.

- [ ] **Step 1: Add `loadTodayUsage` to `companyData.ts`**

In `lib/firebase/companyData.ts`, import `dayKey` (with the existing `lib/ai/rateLimit` imports if any, else add `import { dayKey } from '../ai/rateLimit';`), then add near the other loaders:

```ts
/** Today's AI-run count for the company (the daily cost-guard counter), or 0 if none yet. */
export async function loadTodayUsage(companyId: string): Promise<number> {
  const snap = await getDoc(doc(getDb(), `companies/${companyId}/usage/${dayKey(new Date())}`));
  const n = snap.exists() ? (snap.data() as { n?: unknown }).n : 0;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}
```

- [ ] **Step 2: Add `'billing'` to the `View` type**

In `lib/store.tsx`, in the `export type View =` union (~line 93), add `| 'billing'` (e.g. after `| 'settings'`):

```tsx
  | 'settings'
  | 'billing'
  | 'build';
```

- [ ] **Step 3: Create `BillingView`**

Create `components/views/BillingView.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/firebase/auth';
import { loadTodayUsage } from '@/lib/firebase/companyData';
import { DEFAULT_DAILY_LIMIT } from '@/lib/ai/rateLimit';
import { usageMeter } from '@/lib/billing';

export function BillingView() {
  const { companyId } = useAuth();
  const [used, setUsed] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let live = true;
    loadTodayUsage(companyId)
      .then((n) => live && setUsed(n))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [companyId]);

  const meter = usageMeter(used ?? 0, DEFAULT_DAILY_LIMIT);

  return (
    <section className="view on" id="v-billing">
      <div className="vhead">
        <h1>Billing &amp; Usage</h1>
        <div className="sub">Your plan and today&apos;s activity.</div>
      </div>

      <div className="set-card">
        <div className="bill-row">
          <div className="set-txt">
            <b>Today&apos;s usage</b>
            <span>
              {failed
                ? "Couldn't load your usage right now."
                : used === null
                  ? 'Loading…'
                  : `You've used ${meter.label} · resets at midnight.`}
            </span>
          </div>
        </div>
        {!failed && used !== null && (
          <div className="bill-meter">
            <i style={{ width: `${meter.pct}%` }} />
          </div>
        )}
      </div>

      <div className="set-card">
        <div className="bill-row">
          <div className="set-txt">
            <b>Plan · Free (beta)</b>
            <span>Pro is coming — more runs, priority byte, and team seats.</span>
          </div>
          <button className="set-link" disabled title="Coming soon">
            Upgrade — coming soon
          </button>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Route `'billing'` in `AppRoot`**

In `components/AppRoot.tsx`, add the import and a branch in the view ternary. Add near the other view imports (line ~23):

```tsx
import { BillingView } from './views/BillingView';
```

In the ternary, add a `billing` branch (e.g. right after the `settings` branch at line ~72):

```tsx
    ) : view === 'settings' ? (
      <SettingsView />
    ) : view === 'billing' ? (
      <BillingView />
```

- [ ] **Step 5: Add the CSS**

In `app/globals.css`, near the `.set-card` rules (find with `grep -n "\.set-card" app/globals.css`), add:

```css
/* billing & usage */
.bill-row {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 20px 0;
}
.bill-meter {
  height: 6px;
  border-radius: 99px;
  background: var(--hairline);
  overflow: hidden;
  margin: 0 0 18px;
}
.bill-meter i {
  display: block;
  height: 100%;
  background: var(--accent, #7c3aed);
  transition: width 0.4s ease;
}
```

- [ ] **Step 6: Typecheck + scoped lint**

Run: `npm run typecheck && npx eslint components/views/BillingView.tsx lib/firebase/companyData.ts lib/store.tsx components/AppRoot.tsx`
Expected: typecheck only the 2 baseline `firestore.rules.test.ts` errors; scoped eslint 0 errors. (Do NOT run `eslint .` — it hangs.)

- [ ] **Step 7: Commit**

```bash
git add lib/firebase/companyData.ts lib/store.tsx components/views/BillingView.tsx components/AppRoot.tsx app/globals.css
git commit -m "feat(billing): Billing & Usage view — today's usage vs the daily limit + coming-soon Upgrade"
```

---

### Task 3: Settings — real Account section

**Files:**
- Modify: `components/views/SettingsView.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `useAuth()` (`user` with `displayName`/`email`).
- Produces: a real Account section rendered for all users; the dev toggle gated behind `NODE_ENV==='development'`.

- [ ] **Step 1: Add the Account section + gate the dev toggle**

In `components/views/SettingsView.tsx`, add `import { useAuth } from '@/lib/firebase/auth';` and, inside the component, derive identity:

```tsx
  const { user } = useAuth();
  const name = user?.displayName || user?.email?.split('@')[0] || 'You';
  const email = user?.email ?? '';
  const initial = (name.trim()[0] || 'Y').toUpperCase();
  const isDev = process.env.NODE_ENV === 'development';
```

Update the header sub-copy and insert an Account card as the FIRST card, then wrap the existing dev `set-card` so it only renders in development:

```tsx
      <div className="vhead">
        <h1>Settings</h1>
        <div className="sub">Your account.</div>
      </div>

      <div className="set-card">
        <div className="set-row">
          <div className="acct">
            <span className="acct-av">{initial}</span>
            <div className="set-txt">
              <b>{name}</b>
              {email && <span>{email}</span>}
            </div>
          </div>
        </div>
      </div>

      {isDev && (
        <div className="set-card">
          {/* …the existing "Track Claude Code sessions" set-row, unchanged… */}
        </div>
      )}
```

_(Keep the existing dev toggle `set-row` markup verbatim inside the `{isDev && …}` block. The `getTrackingState`/`setTracking`/`toggle`/`state`/`busy` logic stays as-is — it just no longer renders in prod.)_

- [ ] **Step 2: Add the CSS**

In `app/globals.css`, near the `.set-card`/`.set-row` rules, add:

```css
/* settings — account row */
.acct {
  display: flex;
  align-items: center;
  gap: 14px;
}
.acct-av {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--accent, #7c3aed);
  color: #fff;
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 16px;
  flex: none;
}
```

- [ ] **Step 3: Typecheck + scoped lint**

Run: `npm run typecheck && npx eslint components/views/SettingsView.tsx`
Expected: typecheck baseline only; scoped eslint 0 errors.

- [ ] **Step 4: Commit**

```bash
git add components/views/SettingsView.tsx app/globals.css
git commit -m "feat(settings): real Account section; dev toggle gated to development"
```

---

### Task 4: Support modal + feedback write

**Files:**
- Modify: `lib/firebase/companyData.ts` (add `sendSupportMessage`; ensure `addDoc`/`collection` imported)
- Create: `components/SupportModal.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `canSendSupport` (Task 1); `useAuth()`; `getDb`/`addDoc`/`collection`.
- Produces: `sendSupportMessage(msg: string, name: string, email: string): Promise<void>`; `<SupportModal open onClose>`.

- [ ] **Step 1: Add `sendSupportMessage` to `companyData.ts`**

In `lib/firebase/companyData.ts`, ensure the Firestore imports include `addDoc` and `collection` (add `collection` to the existing `firebase/firestore` import if missing), then add:

```ts
/** A founder-initiated support message → the existing `feedback` collection (kind:'support'). */
export async function sendSupportMessage(msg: string, name: string, email: string): Promise<void> {
  await addDoc(collection(getDb(), 'feedback'), {
    kind: 'support',
    message: msg.trim(),
    name,
    email,
    ts: Date.now(),
  });
}
```

- [ ] **Step 2: Create `SupportModal`**

Create `components/SupportModal.tsx`:

```tsx
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
              onChange={(e) => setMsg(e.target.value)}
            />
            {error && <p className="sup-err">Couldn&apos;t send — try again.</p>}
            <div className="so-acts">
              <button className="so-cancel" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                className="so-confirm"
                onClick={send}
                disabled={!canSendSupport(msg) || busy}
              >
                {busy ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add the CSS**

In `app/globals.css`, near the `.so-modal` rules (find with `grep -n "\.so-modal" app/globals.css`), add:

```css
.so-modal.sup {
  width: 420px;
  max-width: calc(100vw - 40px);
}
.sup-in {
  width: 100%;
  min-height: 96px;
  margin: 12px 0;
  padding: 10px 12px;
  border: 1px solid var(--hairline);
  border-radius: 10px;
  font-family: var(--sans);
  font-size: 14px;
  resize: vertical;
}
.sup-err {
  color: #c0392b;
  font-size: 12.5px;
  margin-bottom: 8px;
}
```

- [ ] **Step 4: Typecheck + scoped lint**

Run: `npm run typecheck && npx eslint components/SupportModal.tsx lib/firebase/companyData.ts`
Expected: typecheck baseline only; scoped eslint 0 errors.

- [ ] **Step 5: Commit**

```bash
git add lib/firebase/companyData.ts components/SupportModal.tsx app/globals.css
git commit -m "feat(support): support modal → writes to the feedback collection (kind:'support')"
```

---

### Task 5: The account menu (`Topbar.tsx`)

**Files:**
- Modify: `components/Topbar.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `useApp()` (`show`); `SupportModal` (Task 4); the `'billing'`/`'settings'` views (Tasks 2/3).
- Produces: the grouped account menu.

- [ ] **Step 1: Wire navigation + Support into the menu**

In `components/Topbar.tsx`:

1. Add imports: `import { useApp } from '@/lib/store';` and `import { SupportModal } from './SupportModal';`.
2. In the component, add `const { show } = useApp();` and `const [support, setSupport] = useState(false);`.
3. Replace the menu body (the `tb-menu` div, currently `who` + a single `Sign out` link) with the grouped menu:

```tsx
          <div className="tb-menu" onClick={(e) => e.stopPropagation()}>
            <div className="who">
              <b>{name}</b>
              {email && <span>{email}</span>}
            </div>
            <div className="tb-sep" />
            <a
              onClick={() => {
                setOpen(false);
                show('settings');
              }}
            >
              Settings
            </a>
            <a
              onClick={() => {
                setOpen(false);
                show('billing');
              }}
            >
              Billing &amp; Usage
            </a>
            <a
              onClick={() => {
                setOpen(false);
                setSupport(true);
              }}
            >
              Support
            </a>
            <div className="tb-sep" />
            <a onClick={askSignOut}>Log out</a>
          </div>
```

4. Wire the topbar **Upgrade** span to open Billing — replace `<span className="upg">Upgrade</span>` with:

```tsx
          <button
            className="upg"
            onClick={() => {
              setOpen(false);
              show('billing');
            }}
          >
            Upgrade
          </button>
```

5. Render the Support modal at the end of the fragment (next to the sign-out `confirming` modal):

```tsx
      <SupportModal open={support} onClose={() => setSupport(false)} />
```

_(The sign-out confirm flow, `askSignOut`, and the outside-click/Esc effects stay unchanged. "Sign out" copy in the menu becomes "Log out"; the confirm modal keeps its "Sign out of Codepet?" wording.)_

- [ ] **Step 2: Add the CSS**

In `app/globals.css`, near the `.tb-menu` rules (find with `grep -n "\.tb-menu" app/globals.css`), add:

```css
/* account menu — grouped rows */
.tb-menu .tb-sep {
  height: 1px;
  background: var(--hairline);
  margin: 6px 0;
}
.tb-menu a {
  display: block;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  color: var(--t-1);
  font-size: 13.5px;
}
.tb-menu a:hover {
  background: var(--surface-2, #f4f1fb);
  color: var(--accent-deep, #5b27b0);
}
```

_(If `.tb-menu a` already has base rules, these refine them — keep the existing look, just ensure the new rows and separators render consistently. Adjust only if a property conflicts.)_

- [ ] **Step 3: Full gate**

Run: `npm run typecheck && npx eslint components/Topbar.tsx && npm run test && npm run format:check`
Expected: typecheck baseline only; scoped eslint 0 errors; Vitest green (includes `lib/billing.test.ts`); format clean. If `format:check` flags any touched file, run `npm run format` and re-commit (CI `verify` runs it).

- [ ] **Step 4: Manual verification (deferred to the Vercel PR preview)**

_Not runnable here (`next build`/`next dev` unreliable). Checklist:_ open the avatar menu → grouped **Settings · Billing & Usage · Support · Log out** → Settings shows the **Account** card (dev toggle hidden in prod) → Billing shows **today's usage vs 30** + a meter + the disabled "Upgrade — coming soon" → Support opens the modal, sending writes a `feedback` record (or shows the graceful error if the create rule isn't in place) → Log out still confirms → the topbar **Upgrade** now opens Billing.

- [ ] **Step 5: Commit**

```bash
git add components/Topbar.tsx app/globals.css
git commit -m "feat(topbar): grouped account menu (Settings · Billing & Usage · Support · Log out)"
```

---

## Notes for the executor

- **Worktree limits:** `next build`/`next dev` unreliable (symlinked node_modules); whole-repo `eslint .` hangs. Gate on typecheck + scoped lint + `npm run test` + `format:check`; visual on the Vercel PR preview.
- **Support write depends** on a Firestore `feedback` create rule existing (an ops/console item flagged in the spec) — the modal fails gracefully if it's missing.
- **Baseline:** `npm run typecheck` shows exactly 2 pre-existing `firestore.rules.test.ts` errors — environmental, unrelated; confirm unchanged.
