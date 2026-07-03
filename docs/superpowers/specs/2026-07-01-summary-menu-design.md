# Summary menu — design

**Date:** 2026-07-01
**Status:** Approved (design), pending implementation plan

## Goal

Add a new **Summary** menu item and view — a playful, at-a-glance recap of Byte's
recent activity. Layout is ported from a provided mockup; content is in English and
styled with the app's existing light (cream/purple) theme tokens rather than the
mockup's dark/green palette.

## Decisions (locked)

- **Placement:** new nav item in `Sidebar`, directly under `Overview`; new view in
  `components/views/`. No existing view is modified in behavior.
- **Data:** static mock, hardcoded to match the mockup. A single typed const at the
  top of the view file, easy to swap for real data later.
- **Language/tone:** English, keeping the friendly/playful voice of the mockup.
- **Visual style:** app's light theme tokens (`--surface`, `--accent`, `--teal`,
  `--gold`, `--t-*`), mockup's layout preserved.

## Nav & routing

- `lib/store.tsx` — extend the `View` union type with `'summary'`.
- `components/Sidebar.tsx` — add a nav entry `{ view: 'summary', label: 'Summary', icon }`
  in the `NAV` array, placed right after `Overview`. New sparkle-style SVG icon.
- `components/AppRoot.tsx` — add a render branch: `view === 'summary' ? <SummaryView /> : …`.
  Static import (not lazy) — it has no heavy deps.

## New view: `components/views/SummaryView.tsx`

A `.view` section following the `CompanyView` pattern (class-based, not inline blobs).
Sections top-to-bottom:

1. **Header** (`.vhead`): h1 "Summary" · sub "Byte's week at a glance".
2. **Greeting banner** (`.sum-hero`): `<Byte>` sprite (large) + headline
   "Byte's having a blast! 😊" + subline "AI pitched in this week — fixed 3 bugs, too"
   - a `Lv 4` pill on the right.
3. **Stat row** (`.sum-stats`, 3 cards): each card = small label + big value.
   - `coins spent` → **1.2M**
   - `cost` → **$18**
   - `saved` → **+7 hrs** (positive value tinted `--teal`)
4. **Achievements** (`.sum-ach`): label "YOU'VE NAILED THESE! ⭐" + pills:
   - ✓ think like an owner (done — filled)
   - ✓ spend coins wisely (done — filled)
   - ⏳ double-check before done (in progress — outline)
   - ⏳ help Byte remember (in progress — outline)
5. **Recent builds** (`.sum-builds`): heading "Recent builds" + rows, each row =
   status icon + title + right-aligned `cost · note`:
   - ✓ Build the login screen — `280K · done clean`
   - ✓ Fix the cart bug — `180K · done clean`
   - ⚠ Clean up the API — `540K · a bit pricey`
6. **CTA** (`.sum-cta`): full-width accent button
   "Let's build something with Byte! →" → `show('tasks')`.

### Mock data shape

Typed consts local to the file, e.g.:

```ts
const HERO = {
  title: "Byte's having a blast! 😊",
  sub: 'AI pitched in this week — fixed 3 bugs, too',
  level: 4,
};
const STATS = [
  { label: 'coins spent', value: '1.2M' },
  { label: 'cost', value: '$18' },
  { label: 'saved', value: '+7 hrs', good: true },
];
const ACHIEVEMENTS = [
  { text: 'think like an owner', done: true },
  { text: 'spend coins wisely', done: true },
  { text: 'double-check before done', done: false },
  { text: 'help Byte remember', done: false },
];
const BUILDS = [
  { title: 'Build the login screen', cost: '280K', note: 'done clean', warn: false },
  { title: 'Fix the cart bug', cost: '180K', note: 'done clean', warn: false },
  { title: 'Clean up the API', cost: '540K', note: 'a bit pricey', warn: true },
];
```

## Styling

Add a `.sum-*` block to `app/globals.css` following existing naming conventions
(`.deptrow`, `.vhead`, `.petcard`). Cards use `--surface` + `--hairline` borders +
`--sh-s/--sh-m` shadows. Positive stat uses `--teal`; warning build uses `--gold`.

## Files touched

- `lib/store.tsx` (View type) — modified
- `components/Sidebar.tsx` (nav item + icon) — modified
- `components/AppRoot.tsx` (render branch + import) — modified
- `components/views/SummaryView.tsx` — **new**
- `app/globals.css` (`.sum-*` classes) — modified

## Out of scope (YAGNI)

- Wiring stats/achievements/builds to real app data (future work — mock only now).
- Persistence, analytics events, or level progression logic.
- Dark/green theming.

## Testing

No business logic to unit-test (static presentation). Verification is manual:
`yarn dev`, click the Summary tab, confirm all five sections render, the Lv pill
shows, and the CTA switches to the Tasks view. Ensure `yarn typecheck` + `yarn lint`
pass.
