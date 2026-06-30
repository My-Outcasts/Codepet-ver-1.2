# First Install — design spec

**Date:** 2026-06-30
**Status:** Approved, ready for implementation plan

## Goal

Add a "first install" experience, ported from `codepet-demo-warm_2.html` CH1 ("Gặp Byte"),
as a new menu under the sidebar's **Your setup** group. Bấm một nút để "wake byte up": chạy
animation cài đặt toolkit, **thực sự** bật các skills/agents được đề xuất trong `ENV`, và **nhớ**
là đã cài để lần sau không chạy lại từ đầu.

This is distinct from the existing `Onboarding` wizard (profile/project questionnaire). First
install is about setting up byte's environment/toolkit.

## Scope

### In scope

- New `install` view + sidebar menu under "Your setup", above "Environment".
- Animated "wake byte up" flow adapted to the app's existing light/warm design language
  (reuse `<Byte>`, `.view`/`.vhead` patterns — do NOT port the demo's dark theme).
- One-click install that flips recommended skills + agents (`rec:1`) to active (`s=1`) in `ENV`,
  syncing with the Environment view and the sidebar `envPending` badge.
- Optional connectors (GitHub, Notion) with their own "Connect" buttons (require user action,
  not auto-installed).
- Persist an `installed` flag in `localStorage` so a return visit shows a "ready" recap state
  with a "Re-run setup" affordance instead of replaying the animation.

### Out of scope (YAGNI)

- No real hooks/statusline categories (ENV has none) — they appear only as decorative chips in
  the starter pack.
- No change to the existing `Onboarding` wizard flow.
- No backend/server persistence — `localStorage` only.

## Architecture

### State (`lib/store.tsx`)

- Add `'install'` to the `View` union.
- Add to `AppState`:
  - `installed: boolean`
  - `markInstalled: () => void` — sets `installed = true` and writes `localStorage['codepet:installed'] = '1'`.
- On mount (client-only `useEffect`), read `localStorage['codepet:installed']` to hydrate
  `installed`. Initial state is `false` to keep SSR and first client render identical (avoids
  hydration mismatch); the effect upgrades it after mount.

### Sidebar (`components/Sidebar.tsx`)

- Add an `install` nav item inside the existing "Your setup" group, rendered **above** the
  "Environment" item.
- Badge: show a "needs setup" dot/indicator when `!installed`; show ✓ (or no badge) when
  `installed`.

### Install view (`components/views/InstallView.tsx`)

- New client component, rendered when `view === 'install'` (wire into `AppRoot` Shell's
  `ActiveView` switch).
- Two render states driven by `installed`:
  - **Not installed (fresh):**
    - Hero: `<Byte>` + heading ("Let's wake byte up") + subtitle.
    - Big primary button "▶ Wake byte up".
    - On click: disable button → label "Setting up…", run a staged `setTimeout` animation:
      - Row 1 "Unpacking byte's toolkit…" → ✓; reveal starter-pack chips (recommended skills +
        agents from `ENV`, plus decorative statusline/hook chips).
      - Row 2 "byte's awake! 🎉" → ✓; Byte plays a happy state; show "ready" tag.
    - During the animation, flip recommended skills + agents (`rec:1`) to `s=1` in `ENV` and
      call `bump()`; call `markInstalled()` at completion.
    - Connectors section: GitHub + Notion rows with "Connect" buttons that flip that connector's
      `s=1` (real `ENV` mutation + `bump()`).
    - "Skip → go to Environment" link → `show('env')`.
  - **Installed (return visit):**
    - "byte is ready" recap: list which skills/agents/connectors are currently on (read from
      `ENV`), Byte in a happy/idle state.
    - "Re-run setup" button → resets the view to the fresh animation (does not clear `installed`;
      simply replays locally).

### Styling (`app/globals.css`)

- Add `.install-*` classes matching existing tokens (`--surface`, `--accent`, `--t-1`, hairlines,
  the app's button styles). Reuse existing button/card classes where they fit.

## Data flow

1. User opens `install` view from sidebar.
2. Click "Wake byte up" → animation → mutate `ENV` (skills/agents `rec:1` → `s=1`) → `bump()` →
   Environment view + sidebar badge update live.
3. `markInstalled()` → `localStorage` set → sidebar swaps to ✓ state.
4. Return visit → store hydrates `installed=true` → install view shows recap state.

## Error / edge handling

- `localStorage` access wrapped in try/catch (private mode / unavailable) — treat failure as
  "not installed", no crash.
- Animation timers cleaned up on unmount (clear all `setTimeout` in the effect cleanup).
- Re-running setup when items are already `s=1` is idempotent (flip-to-1 is a no-op).

## Testing

- Manual/visual: fresh load shows fresh install state; clicking wakes byte, chips appear,
  Environment view reflects newly-active skills/agents, sidebar badge clears.
- Reload page → install view shows "ready" recap; sidebar shows ✓.
- "Re-run setup" replays animation without errors.
- Connector "Connect" toggles the connector on in both Install and Environment views.
