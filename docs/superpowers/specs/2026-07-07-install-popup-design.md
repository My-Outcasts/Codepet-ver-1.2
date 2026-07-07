# First install → popup (2026-07-07)

The "First install" sidebar menu + full view becomes a one-time popup, so a new
founder can install byte's toolkit the moment they land in the app — and a
persistent Topbar pill covers the "install later" path. Install is a setup step,
not a destination; it doesn't deserve permanent navigation.

## Decisions (confirmed with the founder)

1. **Auto-show once.** The popup appears the first time the app is ready
   (hydrated, onboarding finished) and the toolkit isn't installed. Closing it —
   any way — writes a `codepet:install-prompted` flag and it never auto-shows
   again. No per-session nagging.
2. **Install-later affordance = Topbar pill.** An "⚡ Wake byte up" pill with a
   reminder dot sits next to Upgrade while the toolkit isn't installed; clicking
   reopens the popup. It disappears once installed.
3. **The old view is gone.** `InstallView`, the sidebar "First install" item, and
   the `'install'` route are removed. The popup carries the full content:
   one-click install + item statuses (local) / copy-paste command (remote). The
   Settings link that pointed at the view now opens the popup.

## Pieces

- `lib/installPrompt.ts` — pure gate: `shouldPromptInstall({ hydrated,
onboarding, installed, prompted })` + the localStorage key. Unit-tested.
- `components/InstallModal.tsx` — the former view's content in an
  `so-overlay`-pattern modal ("Later" button + backdrop click to dismiss;
  Byte-cheer success state). Reuses the existing install server actions.
- Store — `installPromptOpen` + `openInstallPrompt()` / `closeInstallPrompt()`.
  Auto-show effect: when the gate passes, first call `getStatus()` once — if the
  toolkit is already on this machine (fresh browser, old install) it syncs
  `installed=true`, marks prompted, and skips the popup; otherwise opens it.
  Closing marks prompted.
- Topbar — the pill, gated on `!installed`.
- Removals — sidebar block, `'install'` in the `View` union, the AppRoot case,
  `components/views/InstallView.tsx` itself.

## Error handling

- `getStatus()` failing during the auto-show check still opens the popup (the
  modal's own refresh reports concrete errors); install/uninstall errors render
  per-item rows exactly as the old view did.
- Storage unavailable (private mode): gate treats "can't read the flag" as
  prompted=false, "can't write" as best-effort — worst case the popup shows
  again next visit, which is acceptable.

## Testing

- `shouldPromptInstall` unit tests (all gate combinations).
- Existing installer/server-action tests already cover install mechanics.
- Manual pass: fresh profile → popup after onboarding; Later → pill shows;
  pill → popup; install → pill gone, popup shows "byte is ready" on reopen via
  Settings link.
