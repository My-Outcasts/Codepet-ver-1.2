# Choose your companion — design

**Date:** 2026-07-07
**Status:** Approved, ready for planning

## Problem

Codepet ships with a single character, **byte** — a purple pixel robot that is the
founder's companion: the face on the sidebar `Companion · Lv.N` card, the chat
avatar, and the first-person voice across every surface. Six more characters now
exist as art (**Nova, Crash, Sage, Glitch, Luna, Null**) but there is no way to use
them. We want the founder to be able to pick which character accompanies them.

## Decision summary

The characters become a **user-selectable companion**, not a department mapping and
not a progression/unlock loop. The founder chooses one character; it accompanies
them throughout the project. Decisions locked during brainstorming:

- **Role:** a chosen companion, not department specialists. No tie to the 8 departments.
- **Depth:** identity + voice only. Same AI engine, tools, and pipeline. The
  companion changes who is on screen and how they talk — never _what_ they can do.
- **Choice:** picked at onboarding, switchable anytime from Settings. Default `byte`.
- **Replacement:** the chosen companion replaces byte at every chrome point — card,
  chat avatar + attribution, department header. byte is simply the default of seven.
- **Leveling:** out of scope. The `Lv.N` card renders whatever it renders today; a
  real XP model is a separate future cycle.

## Roster

One `COMPANIONS` registry is the single source of truth. Seven entries:

| id       | name   | sprite                   | tone (persona line, editable)                     |
| -------- | ------ | ------------------------ | ------------------------------------------------- |
| `byte`   | byte   | `/companions/byte.png`   | the reliable companion — warm, clear, encouraging |
| `nova`   | Nova   | `/companions/nova.svg`   | upbeat and energetic; optimistic launch energy    |
| `crash`  | Crash  | `/companions/crash.svg`  | blunt, fast, ship-it; no-nonsense builder         |
| `sage`   | Sage   | `/companions/sage.svg`   | calm, wise, reflective strategist                 |
| `glitch` | Glitch | `/companions/glitch.svg` | playful, quirky, experimental tinkerer            |
| `luna`   | Luna   | `/companions/luna.svg`   | gentle, steady, reassuring                        |
| `null`   | Null   | `/companions/null.svg`   | sharp, dry, precise analyst                       |

Each entry: `{ id, name, sprite, tone }`. No `level`, `unlockAt`, or department key.

### Asset intake

Source art lives in `~/Downloads/Codepet brand (1)/` as SVGs (`Crash (1) 1.svg`,
`Sage (2) 1.svg`, and `Frame 4/5/6/7 (…) 1.svg` for Nova/Glitch/Luna/Null — mapping
confirmed against the labelled roster image). They are copied into
`public/companions/` and renamed to `{id}.svg`. byte keeps its existing
`public/byte.png`, copied/aliased to `/companions/byte.png`. Each character is
finished art — there is **no** tint/silhouette fallback.

## Components

### `<Companion>`

Generalize the current `<Byte>` component into:

```tsx
<Companion id="luna" size="s28" className="…" />
```

It renders `/companions/{id}.svg` (or the `.png` for `byte`). `<Byte>` is kept as a
thin alias (`<Companion id="byte" />`) so existing call-sites keep working and can be
migrated incrementally. All three chrome swap points render `<Companion id={activeId} />`.

### Active-companion state

- **Store:** the app store (`lib/store.tsx`) holds `companionId` (default `'byte'`)
  and a selector/derived `activeCompanion` = the registry entry.
- **Persistence:** `companionId` persists on the founder record in
  `companies/{uid}` (via the existing companyData layer), so the choice survives
  reloads and follows the project.
- **Hydration:** an unknown/missing `companionId` falls back to `'byte'`.

## Where the companion appears (three chrome swap points)

1. **Sidebar companion card** (`components/Sidebar.tsx`, ~line 226) — `<Byte>` →
   `<Companion id={activeId} />`; the hardcoded name `byte` → `activeCompanion.name`.
   The `Companion · Lv.N` label and progress bar are unchanged (leveling out of scope).
2. **Chat** (`components/Copilot.tsx`, ~line 224) — the avatar renders the active
   companion; messages with `role === 'byte'` keep the internal role key `'byte'`
   (not renamed — it is a data key, not display) but render the active companion's
   avatar and name in the UI.
3. **Department header** (`components/views/DepartmentDetail.tsx`, ~line 127) —
   `<Byte>` → active companion; the existing `d.byte` intro string is now attributed
   to that character (same copy content, spoken by the chosen companion).

## Voice — identity + voice only

When a chat or task prompt is built, prepend the active companion's `tone` line:

> "You are Luna — gentle and steady; speak in first person as Luna."

For `byte` the line is byte's existing warm/clear framing (no behaviour change from
today). This is a single prepended sentence on the **existing** prompt — same model,
same tools, same pipeline, **zero extra API calls**. Only the persona framing changes.

## Onboarding step

Add a **"Choose your companion"** step to the onboarding flow
(`components/Onboarding.tsx`): the seven characters shown in a grid (sprite + name +
one-line tone), one selectable to continue. Selection writes `companionId`. `byte` is
pre-selected as the default so a founder who skips still gets a companion.

## Settings switcher

Add a companion switcher to `components/views/SettingsView.tsx` (Account section):
the same 7-character grid, current selection highlighted, tapping another sets it
active immediately (updates store + persists). No dead-end — the onboarding choice is
never permanent.

## Scope boundaries (YAGNI)

**In scope:** the registry, `<Companion>` component + art intake, `companionId`
store/persistence, onboarding picker, Settings switcher, the three chrome swap points,
and the persona `tone` line.

**Out of scope (explicitly):**

- **Leveling / XP.** The `Lv.N` card is untouched; a real XP model is a future cycle.
- **Per-companion memory, toolkit, or skills.** The engine and capabilities are identical
  across companions.
- **Departments.** No character↔department mapping.
- **Deep prose de-byte-ing.** The UI _chrome_ (card, chat, dept header) uses the chosen
  name/sprite from day one. Baked-in literal `"byte"` mentions inside narrative copy
  strings (onboarding prose, `lib/data.ts` blurbs) are **left as-is** this cycle and
  flagged as a light follow-up copy pass.

## Files touched (anticipated)

- `public/companions/*` — new art (6 SVG + byte).
- `lib/data.ts` (or a new `lib/companions.ts`) — `COMPANIONS` registry + `tone` lines.
- `components/Byte.tsx` → `components/Companion.tsx` (with `<Byte>` alias).
- `lib/store.tsx` — `companionId` state + `activeCompanion` selector.
- `lib/firebase/companyData.ts` (+ `schema.ts`) — persist/hydrate `companionId`.
- `lib/ai/chat.ts` (and the task-run prompt builder) — prepend the active `tone` line.
- `components/Sidebar.tsx`, `components/Copilot.tsx`,
  `components/views/DepartmentDetail.tsx` — three chrome swap points.
- `components/Onboarding.tsx` — the picker step.
- `components/views/SettingsView.tsx` — the switcher.

## Testing

- Unit: the `COMPANIONS` registry resolves each id to a valid entry; unknown id →
  `byte` fallback.
- Unit: prompt builder prepends the correct `tone` for the active companion.
- Behaviour (Vercel preview, per repo convention — first-run is unreadable on
  `next dev`): pick a non-byte companion at onboarding → it is the face in the sidebar
  card, chat, and a department header; switch in Settings → all three update; reload →
  choice persists.
