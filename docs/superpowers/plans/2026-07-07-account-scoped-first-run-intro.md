# Account-Scoped First-Run Intro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Overview first-run intro appear once **per account** by persisting an `introSeenAt` stamp on `companies/{uid}`, replacing the browser-global `localStorage` flag that wrongly suppresses the intro for new accounts on an already-used browser.

**Architecture:** Mirror the existing `companionId` persistence rail — a `companies/{uid}` field, a thin `persist*` writer, store state hydrated inside the existing company-load block, and context exposure. `OverviewView` reads/writes the intro-seen state through the store instead of `localStorage`. The pure phase machine (`lib/overviewIntro.ts`) is unchanged except for deleting a now-dead constant.

**Tech Stack:** Next.js App Router, React, TypeScript, Firebase Firestore client SDK, Vitest.

## Global Constraints

- **Pure account-based migration.** Ignore the old `localStorage['codepet:overview-intro-seen']` flag entirely. The intro shows iff **this account** has no `introSeenAt`. Do not read, back-fill from, or preserve the old browser flag. (Honoring it re-suppresses new accounts on a shared browser — the exact bug being fixed.)
- **Idempotent write.** Calling the store's `markIntroSeen()` more than once must result in **at most one** Firestore write; an account already marked seen triggers no state churn and no write.
- **No first-paint flash.** The provider renders children only when `hydrated` is true (`store.tsx`: `{hydrated ? children : <HydrateScreen />}`), so `OverviewView`'s `useState` initializer may read the store's `introSeen` directly — it is accurate at mount.
- **Mirror `companionId` conventions verbatim** (field placement, `persist*` shape, hydrate site, context wiring) — this is the proven pattern in these files.
- **No new Firestore rule, no data migration.** `introSeenAt` is a field on the existing owner-writable `companies/{uid}` doc; absent reads as "not seen."
- **Testing convention:** thin `updateDoc` writers (like `persistCompanion`) are **not** unit-tested against a Firestore mock in `companyData.test.ts` (which exercises only pure helpers). Do not add such a test for `persistIntroSeen`. The read-side decision is already covered by `introInitialPhase` tests in `lib/overviewIntro.test.ts`.
- Branch off `origin/main@ac03428` (or later); worktree `feat/account-first-run`. Verify first-run on the **Vercel preview**, not `next dev`.

---

### Task 1: Persistence layer (`introSeenAt` field + writer + hydrate mapping)

**Files:**

- Modify: `lib/firebase/schema.ts` (add field to `CompanyDoc`, beside `companionId` ~line 83)
- Modify: `lib/firebase/companyData.ts` (`CompanyData` interface ~line 159; `loadCompanyData` return ~line 234; new `persistIntroSeen` beside `persistCompanion` ~line 371)
- Test: none new (thin `updateDoc` writer, per Global Constraints); `npx tsc --noEmit` is the gate.

**Interfaces:**

- Produces: `CompanyDoc.introSeenAt?: Millis`, `CompanyData.introSeenAt?: number`, `loadCompanyData` returns `introSeenAt`, and `persistIntroSeen(companyId: string): Promise<void>`.

- [ ] **Step 1: Add the field to `CompanyDoc`**

In `lib/firebase/schema.ts`, inside `interface CompanyDoc`, immediately after the `companionId?: string;` block (the comment + field ending `Absent ⇒ byte.`), add:

```ts
  /** When this account first saw & dismissed the Overview first-run intro.
   *  Absent ⇒ never seen. */
  introSeenAt?: Millis;
```

- [ ] **Step 2: Add `introSeenAt` to the `CompanyData` interface**

In `lib/firebase/companyData.ts`, inside `export interface CompanyData`, immediately after the `companionId?: string;` line (with its comment), add:

```ts
  /** When this account first saw the Overview first-run intro; undefined ⇒ never seen. */
  introSeenAt?: number;
```

- [ ] **Step 3: Map it in `loadCompanyData`'s return object**

In `lib/firebase/companyData.ts`, in the object returned by `loadCompanyData`, immediately after the `companionId: company?.companionId as string | undefined,` line, add:

```ts
    introSeenAt: company?.introSeenAt as number | undefined,
```

- [ ] **Step 4: Add the `persistIntroSeen` writer**

In `lib/firebase/companyData.ts`, immediately after the `persistCompanion` function (ends ~line 377), add — mirroring `persistCompanion` exactly:

```ts
/** Stamp the Overview first-run intro as seen for this account. */
export async function persistIntroSeen(companyId: string): Promise<void> {
  await updateDoc(doc(getDb(), paths.company(companyId)), {
    introSeenAt: Date.now(),
    updatedAt: Date.now(),
  });
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v firestore.rules.test`
Expected: no new errors (only the 2 pre-existing unrelated `firestore.rules.test.ts` errors, if present).

- [ ] **Step 6: Commit**

```bash
git add lib/firebase/schema.ts lib/firebase/companyData.ts
git commit -m "feat(first-run): persist introSeenAt on the company doc"
```

---

### Task 2: Store wiring (`introSeen` state + `markIntroSeen` action + context)

**Files:**

- Modify: `lib/store.tsx` — import (`persistIntroSeen`); state (~line 371, beside `companionId`); hydrate in the load block (~line 621, beside `setCompanionId`); a ref for idempotency; `markIntroSeen` action (near `setCompanion` ~line 744); `AppState` interface (~line 220, after `setCompanion`); context `value` object (~line 2149, after `setCompanion`) and its `useMemo` deps array (~line 2255, after `setCompanion`).
- Test: none new; `npx tsc --noEmit` + full suite are the gates.

**Interfaces:**

- Consumes: `persistIntroSeen` and `loadCompanyData().introSeenAt` from Task 1.
- Produces: `AppState.introSeen: boolean` and `AppState.markIntroSeen: () => void`, available via `useApp()`.

- [ ] **Step 1: Import `persistIntroSeen`**

In `lib/store.tsx`, add `persistIntroSeen` to the existing import block from `./firebase/companyData` (the block that already imports `persistCompanion`, `loadCompanyData`, etc.).

- [ ] **Step 2: Add the state + an idempotency ref**

In `lib/store.tsx`, immediately after the companion state line
`const [companionId, setCompanionId] = useState<string>(DEFAULT_COMPANION_ID);` add:

```ts
// Whether THIS account has seen the Overview first-run intro (hydrated from
// Firestore; drives introInitialPhase). Default false ⇒ a fresh account sees it.
const [introSeen, setIntroSeen] = useState(false);
// Mirror of introSeen for a stale-closure-free idempotency check in markIntroSeen.
const introSeenRef = useRef(false);
```

(If `useRef` is not already imported in this file, add it to the React import. It almost certainly is — confirm.)

- [ ] **Step 3: Keep the ref in sync with the state**

In `lib/store.tsx`, so the ref always reflects the latest `introSeen`, set it wherever `introSeen` is set. Do this by writing through a tiny render-time sync right after the state declaration is fine, but the simplest robust approach: set the ref in the same two places you call `setIntroSeen` (Step 4 hydrate, and the action in Step 5). Add no `useEffect`. Concretely, every `setIntroSeen(x)` is paired with `introSeenRef.current = x;`.

- [ ] **Step 4: Hydrate `introSeen` in the company-load block**

In `lib/store.tsx`, in the `loadCompanyData(companyId).then(({ ... }) => { ... })` destructure, add `introSeenAt` to the destructured fields (beside `companionId: cId`). Then, immediately after the existing `setCompanionId(cId ?? DEFAULT_COMPANION_ID);` line, add:

```ts
setIntroSeen(Boolean(introSeenAt));
introSeenRef.current = Boolean(introSeenAt);
```

- [ ] **Step 5: Add the `markIntroSeen` action**

In `lib/store.tsx`, immediately after the `setCompanion` `useCallback` (ends ~line 756), add:

```ts
const markIntroSeen = useCallback(() => {
  if (introSeenRef.current) return; // already seen — no state churn, no write
  introSeenRef.current = true;
  setIntroSeen(true);
  if (companyId) {
    persistIntroSeen(companyId).catch((err) =>
      console.error('[store] persistIntroSeen failed', err),
    );
  }
}, [companyId]);
```

- [ ] **Step 6: Declare both on the `AppState` interface**

In `lib/store.tsx`, in `interface AppState`, immediately after the `setCompanion: (id: string) => void;` line (~line 220), add:

```ts
  /** Whether this account has seen the Overview first-run intro. */
  introSeen: boolean;
  /** Mark the first-run intro seen for this account (idempotent; persists). */
  markIntroSeen: () => void;
```

- [ ] **Step 7: Expose both in the context value + deps**

In `lib/store.tsx`, in the context `value` object (~line 2149), add `introSeen,` and `markIntroSeen,` immediately after the `setCompanion,` entry. Then, in the same object's `useMemo` dependency array (~line 2255), add `introSeen,` and `markIntroSeen,` immediately after the `setCompanion,` entry. (Both lists must stay in sync — that is why `companionId`/`setCompanion` appear in both places.)

- [ ] **Step 8: Typecheck + full suite**

Run: `npx tsc --noEmit 2>&1 | grep -v firestore.rules.test`
Expected: no new errors.
Run: `npx vitest run`
Expected: all tests pass (no behavior change to tested units yet).

- [ ] **Step 9: Commit**

```bash
git add lib/store.tsx
git commit -m "feat(first-run): expose account introSeen + markIntroSeen from the store"
```

---

### Task 3: Consume the store in `OverviewView` + drop the dead `localStorage` path

**Files:**

- Modify: `components/views/OverviewView.tsx` — remove `INTRO_SEEN_KEY` import + the `readIntroSeen`/`markIntroSeen` module helpers (~lines 30–47); add `introSeen`, `markIntroSeen` to the `useApp()` destructure (~line 195); change the phase initializer (~line 224); the 2 existing `markIntroSeen()` call sites (lines 674, 689) now resolve to the store action.
- Modify: `lib/overviewIntro.ts` — remove the `INTRO_SEEN_KEY` constant.
- Modify: `lib/overviewIntro.test.ts` — remove the `INTRO_SEEN_KEY` import + its assertion.

**Interfaces:**

- Consumes: `introSeen` and `markIntroSeen` from the store (Task 2). No new exports.

- [ ] **Step 1: Confirm the existing intro tests pass (baseline)**

Run: `npx vitest run lib/overviewIntro.test.ts`
Expected: PASS (this is the guard we must keep green through the edit).

- [ ] **Step 2: Remove the `localStorage` helpers + the `INTRO_SEEN_KEY` import in `OverviewView`**

In `components/views/OverviewView.tsx`, change the import on line 30 from:

```ts
import { INTRO_SEEN_KEY, introInitialPhase, type IntroPhase } from '@/lib/overviewIntro';
```

to:

```ts
import { introInitialPhase, type IntroPhase } from '@/lib/overviewIntro';
```

Then delete the entire module-level block (the comment + both helpers), i.e. remove:

```ts
// First-run "seen" flag. Reads default to seen (true) on failure so we never
// re-trap a user behind a broken storage read.
const readIntroSeen = () => {
  try {
    return !!localStorage.getItem(INTRO_SEEN_KEY);
  } catch {
    return true;
  }
};
const markIntroSeen = () => {
  try {
    localStorage.setItem(INTRO_SEEN_KEY, '1');
  } catch {
    /* ignore */
  }
};
```

- [ ] **Step 3: Pull `introSeen` + `markIntroSeen` from the store**

In `components/views/OverviewView.tsx`, in the `useApp()` destructure that ends at line 214, add two entries (e.g. after `clearGrowthSignal,`):

```ts
    introSeen,
    markIntroSeen,
```

- [ ] **Step 4: Read account state in the phase initializer**

In `components/views/OverviewView.tsx`, change the initializer (~lines 223–224) from:

```ts
const [introPhase, setIntroPhase] = useState<IntroPhase>(() => introInitialPhase(readIntroSeen()));
```

to:

```ts
const [introPhase, setIntroPhase] = useState<IntroPhase>(() => introInitialPhase(introSeen));
```

(The 2 call sites at lines 674 and 689 — `markIntroSeen();` inside `handleIntroReveal` and `handleIntroDismiss` — now resolve to the destructured store action. Leave those call sites as-is; do not change the settle transitions, which correctly go straight to `'done'`.)

- [ ] **Step 5: Remove the dead constant in `lib/overviewIntro.ts`**

In `lib/overviewIntro.ts`, delete the `INTRO_SEEN_KEY` export (the comment + the line):

```ts
// localStorage key — retained from the original OverviewIntro so users who
// already dismissed the old intro are not shown the new one.
export const INTRO_SEEN_KEY = 'codepet:overview-intro-seen';
```

- [ ] **Step 6: Update `lib/overviewIntro.test.ts`**

In `lib/overviewIntro.test.ts`, remove `INTRO_SEEN_KEY` from the import list (line 3) and delete the assertion that references it (~line 13, `expect(INTRO_SEEN_KEY).toBe('codepet:overview-intro-seen');`). If that assertion is the only line in its `it(...)` block, remove the whole `it(...)` block.

- [ ] **Step 7: Verify no `localStorage`/`INTRO_SEEN_KEY` references remain**

Run: `grep -rn "INTRO_SEEN_KEY\|overview-intro-seen\|readIntroSeen" components/views/OverviewView.tsx lib/overviewIntro.ts lib/overviewIntro.test.ts`
Expected: no matches.

- [ ] **Step 8: Typecheck + affected test + full suite**

Run: `npx tsc --noEmit 2>&1 | grep -v firestore.rules.test`
Expected: no new errors (in particular, no "unused `introSeen`" — it is consumed by the initializer).
Run: `npx vitest run lib/overviewIntro.test.ts`
Expected: PASS.
Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 9: Format + commit**

```bash
npx prettier --write components/views/OverviewView.tsx lib/overviewIntro.ts lib/overviewIntro.test.ts
git add components/views/OverviewView.tsx lib/overviewIntro.ts lib/overviewIntro.test.ts
git commit -m "feat(first-run): drive the Overview intro from account state, not localStorage"
```

---

## Post-Implementation Verification (manual, on Vercel preview)

Not a code task — the merge gate. On the PR's Vercel preview (prod build; `next dev` is unreliable for first-run):

1. **Fresh account** → first Overview visit shows the intro.
2. Dismiss it (CTA or backdrop) → reload → intro does **not** reappear.
3. **A different new account, same browser** → intro shows (the core bug case).
4. Confirm it still shows while the model is down (example-company banner present) — the intro is not gated on the analysis call.
