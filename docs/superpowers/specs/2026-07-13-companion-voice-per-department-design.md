# Companion voice-per-department — design

_2026-07-13_

## Summary

Reframe the companion from a **global pick** (one chosen pet accompanies the
founder everywhere) into a **per-department cast**: each department has a fixed
pet whose tone colors the AI's voice for that department's work. Because there
are 8 departments and 7 pets, one pet (Null) covers the two least-important
departments (Finance + Legal).

The global "choose your companion" concept is removed and the UI reverts to
neutral (brand-default accent, byte as the default mark). Dark mode is
unaffected.

## The mapping

Single source of truth, added to `lib/companions.ts`:

| Department (`k`) | Pet    | Rationale                                  |
| ---------------- | ------ | ------------------------------------------ |
| `eng`            | byte   | the reliable core; already drafts eng work |
| `sales`          | Crash  | blunt, fast, ship-it closer                |
| `mkt`            | Nova   | upbeat launch energy                       |
| `design`         | Glitch | playful, experimental tinkerer             |
| `ops`            | Sage   | calm, wise strategist / operator           |
| `support`        | Luna   | gentle, steady, reassuring                 |
| `fin`            | Null   | sharp, dry, precise analyst                |
| `legal`          | Null   | shares Null (least-important department)   |

```ts
export function companionForDept(deptKey: string | null | undefined): Companion;
```

Unknown/empty key → byte (`DEFAULT_COMPANION_ID`). `fin` and `legal` both map to
`null` (Null).

## Voice wiring (server)

All three AI routes already receive `deptKey` in their body, so the persona is
resolved from the department rather than a global id:

- **`app/api/run-task/route.ts`** — `composeRunSystem(context) +
personaOverride(companionForDept(deptKey))`
- **`app/api/task-help/route.ts`** — same swap (`deptKey` already present)
- **`app/api/chat/route.ts`** — `personaOverride(companionForDept(focusDeptKey))`,
  where `focusDeptKey` is a new body field sent by the client

The `companionId` body field is dropped from all three; routes ignore it if a
stale client still sends it (backward-safe).

## Chat focus resolution (client)

`components/Copilot.tsx` computes `focusDeptKey` when building the chat request:

> active department view (store `deptKey` when the current view is a department)
> → else the CURRENT NEXT STEP's department → else omit.

When omitted, the chat route falls back to byte. In practice a CURRENT NEXT STEP
almost always exists, so chat almost always carries a real department voice.
byte is not a "host" — it simply speaks when Engineering (or nothing) is in
focus, like any other pet.

## Picker removal + neutral revert

- **Delete** `components/CompanionPicker.tsx`.
- **`components/Onboarding.tsx`** — remove the "pick your companion" step and its
  `CompanionPicker` / `setCompanion(pick)` usage.
- **`components/Sidebar.tsx`** — remove the switcher popover (`pickerOpen`,
  `CompanionPicker`, `setCompanion`).
- **`lib/store.tsx`** — remove `setCompanion` and the `companionId` Firestore
  read/write. `companionId` is **pinned to byte** (`DEFAULT_COMPANION_ID`) rather
  than excised, so the ~13 chrome sites that render `companionById(companionId)`
  keep showing byte with no edits (lower-risk than threading a constant through
  every consumer). The Firestore `companionId` field goes vestigial: no longer
  read or written; existing docs are harmlessly ignored (no migration).
- **`lib/theme.tsx` + `components/AppRoot.tsx`** — remove `applyCompanionAccent`
  / `accentVars` so the accent returns to the brand default. **Dark mode
  (ThemeProvider, `[data-theme]` blocks) stays intact** — only the
  companion-accent layer is stripped.
- **Chrome** — components that render `companionById(companionId)` (Sidebar,
  Topbar, Copilot header, AppRoot, InstallModal, and the rest) switch to the
  byte default (`DEFAULT_COMPANION_ID`). No per-department avatar swapping in the
  chrome or the chat box — the chat stays visually neutral; only the AI's tone
  changes per department.

## Non-goals (YAGNI)

- No per-department avatar/name in the chat box or chrome.
- No per-companion accent re-tinting anywhere.
- No user override of the fixed pet↔department mapping.
- No Firestore migration to strip the old `companionId` field.

## Testing

- Unit (`lib/companions.test.ts`): `companionForDept` for all 8 department keys +
  the unknown/empty fallback to byte; assert `fin` and `legal` both resolve to
  Null.
- Unit: the chat focus-resolution helper (active-dept → next-step → none).
- Manual on the Vercel PR preview: run an Engineering task (byte tone) vs a
  Marketing task (Nova) vs a Legal task (Null); open the Copilot from the
  Marketing view and confirm it speaks as Nova.

## Branch & verification

- Branches off **`develop`** (this work depends on the companion roster and
  theme-accent code that live on `develop`, not `main`) via an isolated worktree
  (concurrent sessions flip the main checkout).
- Verify on the **Vercel PR preview**, not `next dev` (worktree `node_modules`
  is symlinked, which breaks `next dev`).
- PR into `develop` (protected — no direct push).
