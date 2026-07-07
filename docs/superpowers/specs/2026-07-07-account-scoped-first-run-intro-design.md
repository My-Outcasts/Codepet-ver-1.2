# Account-Scoped First-Run Intro — Design

**Date:** 2026-07-07
**Status:** Approved (pending spec review)
**Branch:** `feat/account-first-run` (off `origin/main@ac03428`)

## Problem

The Overview first-run intro (the "spotlight handoff" — `OverviewIntro` + `lib/overviewIntro.ts`,
shipped in PR #77) is meant to greet every new founder the first time they see their company map.
In practice, brand-new accounts often never see it.

**Root cause:** whether the intro shows hinges on a single browser-global flag:

```ts
// components/views/OverviewView.tsx
const readIntroSeen = () => !!localStorage.getItem('codepet:overview-intro-seen'); // INTRO_SEEN_KEY
const [introPhase] = useState(() => introInitialPhase(readIntroSeen())); // seen ? 'done' : 'intro'
```

That flag lives in `localStorage`, keyed to the **browser**, and is never cleared on sign-out, new
sign-up, or `resetCompanyData`. Consequences:

- **A new account opened in a browser that has ever seen the intro → no intro** (the flag is still
  set from a previous session/account). This is the reported bug.
- The mirror failure: the **same** account on a **new** device re-sees the intro, because the flag
  is device-local.

The intro is deliberately **not** gated on the model call, so this problem is independent of the
current "byte couldn't reach the model" credits outage — and this fix is verifiable even while the
model is down.

## Goal

The first-run intro appears **once per account**, decided by account state rather than by the
browser. Specifically:

- A genuinely new account always sees the intro on its first Overview visit.
- Once an account has seen (and dismissed) it, it never auto-shows again for that account, on any
  device.
- Because a "fresh project" is always a new account (`uid`), starting over naturally replays the
  intro — no dedicated reset path needed.

## Non-Goals

- The intro's **content/copy** or the spotlight visuals — unchanged.
- The **"? how to read this map"** reopen chip — already works (manual `onReopen`); untouched.
- Companion **leveling** and any engine changes.
- The **model/credits outage** — separate, billing-only, tracked elsewhere.
- **Migrating** existing browser-dismissed users: decided **pure account-based** (see below).

## Decisions (from brainstorming)

- **Migration → pure account-based.** The old flag is per-browser, so honoring it would re-suppress
  new accounts on a shared browser — reintroducing the exact bug. We therefore **ignore the old
  `localStorage` flag entirely**. The only cost: an existing user who already dismissed the intro
  may see the short, skippable intro **one more time**, after which their account is marked seen
  forever. Acceptable pre-launch with few accounts.
- **Replay on reset → automatic.** There is no same-`uid` "reset company" flow in the app; a fresh
  project is always a new account. A new account has no `introSeenAt`, so the intro replays with no
  extra code.

## Architecture

Mirror the proven **`companionId`** persistence rail (`companies/{uid}` field + `persist*` fn +
store state hydrated in the existing load block + context exposure). Five files.

### 1. `lib/firebase/schema.ts`

Add one optional field to `CompanyDoc`, beside `companionId`:

```ts
export interface CompanyDoc {
  // ...
  companionId?: string;
  /** When this account first saw & dismissed the Overview first-run intro. Absent = never seen. */
  introSeenAt?: Millis;
  // ...
}
```

### 2. `lib/firebase/companyData.ts`

- Add `introSeenAt?: number` to the `CompanyData` interface.
- Map it in `loadCompanyData`: `introSeenAt: company?.introSeenAt as number | undefined`.
- New persister, a direct copy of `persistCompanion`:

```ts
/** Stamp the first-run intro as seen for this account (idempotent at the data layer). */
export async function persistIntroSeen(companyId: string): Promise<void> {
  await updateDoc(doc(getDb(), paths.company(companyId)), {
    introSeenAt: Date.now(),
    updatedAt: Date.now(),
  });
}
```

### 3. `lib/store.tsx`

- New state: `const [introSeen, setIntroSeen] = useState(false);`
- Hydrate inside the **existing** company-load block (no new `useEffect`), reading the loaded
  `introSeenAt`: `setIntroSeen(Boolean(introSeenAt));`
- New action, deps `[companyId]`, idempotent so repeated dismissals don't re-write:

```ts
const markIntroSeen = useCallback(() => {
  if (introSeenTrueRef.current) return; // already seen — no state churn, no write
  setIntroSeen(true);
  if (companyId)
    persistIntroSeen(companyId).catch((err) =>
      console.error('[store] persistIntroSeen failed', err),
    );
}, [companyId]);
```

(Guard via a ref that tracks the current `introSeen`, matching how the store avoids stale-closure
reads elsewhere; or read `introSeen` directly if the deps make that safe. The implementer picks
the mechanism that matches the file's conventions — the contract is: calling `markIntroSeen()`
more than once results in at most one Firestore write.)

- Expose `introSeen` and `markIntroSeen` on `AppState` and in the context `value`.

Because the provider renders children only once `hydrated` is true
(`store.tsx`: `{hydrated ? children : <HydrateScreen />}`), `OverviewView` never mounts before
`introSeen` reflects Firestore — so a `useState` initializer reading `introSeen` is accurate with no
first-paint flash.

### 4. `components/views/OverviewView.tsx`

- Delete the module-level `readIntroSeen` / `markIntroSeen` `localStorage` helpers and the
  `INTRO_SEEN_KEY` import.
- Pull the two new values from the store: `const { introSeen, markIntroSeen } = useApp();` (added to
  the existing `useApp()` destructure).
- Keep the phase initializer, now reading account state:
  `const [introPhase, setIntroPhase] = useState<IntroPhase>(() => introInitialPhase(introSeen));`
- Replace the three call sites that previously called the local `markIntroSeen()` (the intro CTA
  reveal, the backdrop dismiss, and the spotlight settle) with the store's `markIntroSeen()`. Phase
  transitions themselves (`onReveal`/`onSettle`/`onReopen`) are unchanged.

### 5. `lib/overviewIntro.ts` + `lib/overviewIntro.test.ts`

- Remove the now-dead `INTRO_SEEN_KEY` constant (no remaining consumer).
- Drop the single assertion in `overviewIntro.test.ts` that checks its value. All phase-machine
  tests (`introInitialPhase`, `onReveal`, `onSettle`, `onReopen`, `revealAction`) remain unchanged
  and green.

## Data Flow

```
New account signs in
  → loadCompanyData: introSeenAt absent → store introSeen = false
  → provider hydrated → Shell → OverviewView mounts
  → introInitialPhase(false) = 'intro'  → intro shows
  → user dismisses (CTA / backdrop / settle) → markIntroSeen()
        → setIntroSeen(true) + persistIntroSeen(uid)  [introSeenAt = now]
  → next visit / next device: loadCompanyData → introSeenAt present
        → introSeen = true → introInitialPhase(true) = 'done'  → no intro
```

## Testing

- **Unchanged & green:** `lib/overviewIntro.test.ts` phase-machine tests (minus the removed
  `INTRO_SEEN_KEY` assertion). `introInitialPhase(true/false)` already covers the read side of the
  decision.
- **`persistIntroSeen`** follows the established convention: it is a thin `updateDoc` wrapper exactly
  like `persistCompanion`, which is not unit-tested against a Firestore mock (the `companyData.test.ts`
  harness only exercises pure helpers). No new Firestore-mock test is introduced — doing so would
  diverge from the file's testing pattern for one-line writers.
- **Full suite** (`npm test`) stays green.
- **Primary verification — Vercel preview QA** (per the standing "verify first-run on preview"
  practice; local `next dev` is unreliable for first-run due to StrictMode double-mount + HMR):
  1. **Fresh account** → intro shows on first Overview visit.
  2. Dismiss it → reload → intro does **not** show.
  3. **Different account, same browser** → intro shows (the bug's core case).
  4. Works with the model down (example-company banner present) — intro still appears.

## Rollout

- No Firestore rule change: `introSeenAt` is a field on the existing `companies/{uid}` doc the user
  already owns/writes.
- No data migration: absent `introSeenAt` correctly reads as "not seen."
- Backward compatible: old browsers still carry the dead `localStorage` key; it is simply never read
  again. (No cleanup needed; harmless.)
