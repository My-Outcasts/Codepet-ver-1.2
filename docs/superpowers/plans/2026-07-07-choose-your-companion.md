# Choose Your Companion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a founder pick which character (byte, Nova, Crash, Sage, Glitch, Luna, Null) accompanies them — chosen at onboarding, switchable in-app — and have that character be the face, name, and first-person voice everywhere byte currently appears.

**Architecture:** One pure `lib/companions.ts` registry is the single source of truth (id → name, sprite, tone). A generic `<Companion id>` component replaces the hardcoded `<Byte>` (kept as an alias). The choice lives as `companionId` on the store, persisted to `companies/{uid}`, hydrated on load. Three UI chrome points render the active companion; a shared `<CompanionPicker>` drives both the onboarding step and an in-app switcher (opened from the sidebar companion card). Voice is one persona line appended to the existing chat/run-task system prompts server-side — no engine change, no extra API calls.

**Tech Stack:** Next.js (App Router) + React, TypeScript, Firestore (client SDK), Vitest, Anthropic API via existing `/api/chat` + `/api/run-task` routes.

## Global Constraints

- **Identity + voice only.** Never change what the companion can *do* — same model, tools, pipeline. Only the on-screen character, name, and tone change.
- **Default is `byte`.** Any unknown/missing `companionId` resolves to `byte`. `COMPANIONS[0]` MUST be byte.
- **Out of scope (do NOT build):** leveling/XP (the `Companion · Lv.N` card label stays exactly as-is), per-companion memory/toolkit/skills, departments, and de-byte-ing narrative prose in `lib/data.ts`/onboarding copy.
- **Vitest has NO `@/` alias.** Test files under `lib/` MUST import with relative paths (`./companions`, not `@/lib/companions`). App/component code keeps using `@/…`.
- **CI `verify` runs `prettier --check .` repo-wide.** Run `npm run format:check` (and fix with `npm run format` if needed) before every push.
- **Lint bans `react-hooks/set-state-in-effect`.** Do not introduce new `useState` writes inside `useEffect`; reuse the store's existing hydration effect for `companionId` (it already sets state from `loadCompanyData`).
- **Work in an isolated git worktree off `origin/main`** (symlinked `node_modules` there runs `tsc`/`vitest` but breaks `next dev`, so verify behaviour on the Vercel preview, not locally). Branch → PR → merge so it reaches prod.
- **Sprite classes are shared.** `<Companion>` reuses byte's exact wrapper classes (`byte`, `bimg`, size class) so sizing is identical everywhere and no existing CSS changes.

---

## File Structure

- `public/companions/*.svg` — **new** — the 6 specialist sprites (byte keeps `/byte.png`).
- `lib/companions.ts` — **new** — registry, types, `companionById`, `personaOverride`.
- `lib/companions.test.ts` — **new** — registry resolution + persona.
- `components/Companion.tsx` — **new** — generic sprite component.
- `components/Byte.tsx` — **modify** — becomes a thin `<Companion id="byte">` alias.
- `components/CompanionPicker.tsx` — **new** — reusable 7-character grid.
- `lib/firebase/schema.ts` — **modify** — add `companionId?` to `CompanyDoc`.
- `lib/firebase/companyData.ts` — **modify** — load `companionId`; add `persistCompanion`.
- `lib/store.tsx` — **modify** — `companionId` state, `setCompanion`, hydrate, thread into chat.
- `components/Sidebar.tsx`, `components/Copilot.tsx`, `components/views/DepartmentDetail.tsx` — **modify** — three chrome swap points.
- `components/Onboarding.tsx` — **modify** — add the picker step (`OB_TOTAL` 8→9).
- `app/globals.css` — **modify** — picker + sidebar-popover styles.
- `lib/ai/chat.ts`, `app/api/chat/route.ts` — **modify** — thread `companionId` into chat voice.
- `lib/ai/runTask.ts`, `app/api/run-task/route.ts` — **modify** — thread `companionId` into deliverable voice.

---

### Task 1: Companion registry + art intake

**Files:**
- Create: `public/companions/{nova,crash,sage,glitch,luna,null}.svg`
- Create: `lib/companions.ts`
- Test: `lib/companions.test.ts`

**Interfaces:**
- Produces: `interface Companion { id: string; name: string; sprite: string; tone: string }`,
  `COMPANIONS: Companion[]` (byte first), `DEFAULT_COMPANION_ID = 'byte'`,
  `companionById(id: string | null | undefined): Companion`,
  `personaOverride(id: string | null | undefined): string`.

- [ ] **Step 1: Copy the art into place.** Source art is in `~/Downloads/Codepet brand (1)/`. The files `Crash (1) 1.svg` and `Sage (2) 1.svg` are named; `Frame 4/5/6/7 (…) 1.svg` are Nova/Glitch/Luna/Null in unknown order. Copy each to `public/companions/{id}.svg`, verifying by color (Nova = yellow w/ antenna, Glitch = pink, Luna = blue penguin, Null = orange fox):

```bash
mkdir -p "public/companions"
cp "$HOME/Downloads/Codepet brand (1)/Crash (1) 1.svg" public/companions/crash.svg
cp "$HOME/Downloads/Codepet brand (1)/Sage (2) 1.svg"  public/companions/sage.svg
# Inspect the four Frame files and copy each to the matching id by color:
#   yellow+antenna → nova.svg   pink → glitch.svg   blue penguin → luna.svg   orange fox → null.svg
# e.g. after opening them in Finder/Preview to confirm:
#   cp "$HOME/Downloads/Codepet brand (1)/Frame 4 (1) 1.svg" public/companions/<id>.svg   (repeat for 5/6/7)
```

- [ ] **Step 2: Verify all six landed.**

Run: `ls public/companions`
Expected: `crash.svg  glitch.svg  luna.svg  nova.svg  null.svg  sage.svg`

- [ ] **Step 3: Write the failing test.**

Create `lib/companions.test.ts` (relative import — no `@/`):

```ts
import { describe, it, expect } from 'vitest';
import { COMPANIONS, companionById, personaOverride } from './companions';

describe('companions registry', () => {
  it('has byte first as the default', () => {
    expect(COMPANIONS[0].id).toBe('byte');
  });

  it('has all seven characters', () => {
    expect(COMPANIONS.map((c) => c.id)).toEqual([
      'byte', 'nova', 'crash', 'sage', 'glitch', 'luna', 'null',
    ]);
  });

  it('resolves a known id', () => {
    expect(companionById('luna').name).toBe('Luna');
  });

  it('falls back to byte for unknown / missing ids', () => {
    expect(companionById('nope').id).toBe('byte');
    expect(companionById(undefined).id).toBe('byte');
    expect(companionById(null).id).toBe('byte');
  });

  it('gives byte no persona override, but names other companions', () => {
    expect(personaOverride('byte')).toBe('');
    const p = personaOverride('nova');
    expect(p).toContain('Nova');
    expect(p).toContain('first person');
  });
});
```

- [ ] **Step 4: Run it to confirm it fails.**

Run: `npx vitest run lib/companions.test.ts`
Expected: FAIL — `Cannot find module './companions'`.

- [ ] **Step 5: Implement `lib/companions.ts`.**

```ts
// The companion roster — the single source of truth for who can accompany a
// founder. Identity + voice only: each entry differs by name, sprite, and tone;
// the engine, tools, and capabilities are identical across all of them.
// byte MUST be first (the default fallback).
export interface Companion {
  id: string;
  name: string;
  /** Public path to the sprite (byte keeps its original PNG; others are SVGs). */
  sprite: string;
  /** One-line persona, appended to the system prompt so this companion speaks
   *  in its own voice. Empty-effect for byte (byte is the baseline voice). */
  tone: string;
}

export const DEFAULT_COMPANION_ID = 'byte';

export const COMPANIONS: Companion[] = [
  { id: 'byte',   name: 'byte',   sprite: '/byte.png',            tone: 'the reliable companion — warm, clear, and encouraging.' },
  { id: 'nova',   name: 'Nova',   sprite: '/companions/nova.svg', tone: 'upbeat and energetic — an optimist who brings launch energy.' },
  { id: 'crash',  name: 'Crash',  sprite: '/companions/crash.svg',tone: 'blunt, fast, and ship-it — a no-nonsense builder.' },
  { id: 'sage',   name: 'Sage',   sprite: '/companions/sage.svg', tone: 'calm, wise, and reflective — a patient strategist.' },
  { id: 'glitch', name: 'Glitch', sprite: '/companions/glitch.svg',tone: 'playful, quirky, and experimental — a curious tinkerer.' },
  { id: 'luna',   name: 'Luna',   sprite: '/companions/luna.svg', tone: 'gentle, steady, and reassuring — a calm presence for the long haul.' },
  { id: 'null',   name: 'Null',   sprite: '/companions/null.svg', tone: 'sharp, dry, and precise — a rigorous analyst.' },
];

export function companionById(id: string | null | undefined): Companion {
  return COMPANIONS.find((c) => c.id === id) ?? COMPANIONS[0];
}

/**
 * The persona line appended to a system prompt so the active companion speaks in
 * its own voice. Empty for byte (byte is the baseline). Written as an override so
 * it wins over the "You are byte…" opening of the existing prompts.
 */
export function personaOverride(id: string | null | undefined): string {
  const c = companionById(id);
  if (c.id === DEFAULT_COMPANION_ID) return '';
  return `\n\nYOU ARE APPEARING AS ${c.name} — ${c.tone} Speak in the first person as ${c.name}, never as "byte". Keep the same substance, judgment, and helpfulness; only the name and tone are yours.`;
}
```

- [ ] **Step 6: Run the test to confirm it passes.**

Run: `npx vitest run lib/companions.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit.**

```bash
git add public/companions lib/companions.ts lib/companions.test.ts
git commit -m "feat(companions): roster registry + specialist sprites"
```

---

### Task 2: `<Companion>` component (+ `<Byte>` alias)

**Files:**
- Create: `components/Companion.tsx`
- Modify: `components/Byte.tsx`

**Interfaces:**
- Consumes: `companionById` (Task 1).
- Produces: `<Companion id={string} size?={string} className?={string} />`. `<Byte>` keeps its existing `{ size?, className? }` signature.

- [ ] **Step 1: Create `components/Companion.tsx`.**

```tsx
// A companion pixel sprite. Renders whichever character `id` names, reusing byte's
// exact wrapper classes so sizing is identical to the old <Byte> everywhere.
import { companionById } from '@/lib/companions';

export function Companion({
  id,
  size = 's28',
  className = '',
}: {
  id: string;
  size?: string;
  className?: string;
}) {
  const c = companionById(id);
  return (
    <span className={`byte ${size} ${className}`.trim()}>
      <img className="bimg" src={c.sprite} alt={c.name} draggable={false} />
    </span>
  );
}
```

- [ ] **Step 2: Replace `components/Byte.tsx` with a thin alias.**

```tsx
// byte is now companion #1 in the roster. <Byte> stays as a thin alias so existing
// call-sites keep working; new code should prefer <Companion id={…} />.
import { Companion } from './Companion';

export function Byte({ size = 's28', className = '' }: { size?: string; className?: string }) {
  return <Companion id="byte" size={size} className={className} />;
}
```

- [ ] **Step 3: Typecheck.**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit.**

```bash
git add components/Companion.tsx components/Byte.tsx
git commit -m "feat(companions): generic <Companion> component, <Byte> becomes an alias"
```

---

### Task 3: `companionId` state, persistence, hydration

**Files:**
- Modify: `lib/firebase/schema.ts:54-80` (CompanyDoc)
- Modify: `lib/firebase/companyData.ts` (CompanyData type ~123, loadCompanyData return ~181, new `persistCompanion`)
- Modify: `lib/store.tsx` (AppState ~101, provider state ~199, hydrate effect, context value ~1167)

**Interfaces:**
- Consumes: `companionById`, `DEFAULT_COMPANION_ID` (Task 1).
- Produces: store exposes `companionId: string` and `setCompanion(id: string): void`;
  `persistCompanion(companyId: string, companionId: string): Promise<void>`;
  `CompanyData.companionId?: string`.

- [ ] **Step 1: Add the field to `CompanyDoc`.** In `lib/firebase/schema.ts`, inside `CompanyDoc` (after `personalizedAt?`):

```ts
  /** The founder's chosen companion character (see COMPANIONS in lib/companions.ts).
   *  Absent ⇒ byte. */
  companionId?: string;
```

- [ ] **Step 2: Load it.** In `lib/firebase/companyData.ts`, add to the `CompanyData` interface (near `onboardedAt?`):

```ts
  /** The founder's chosen companion id; undefined ⇒ byte. */
  companionId?: string;
```

and in the `loadCompanyData` return object (alongside `onboardedAt`):

```ts
    companionId: company?.companionId as string | undefined,
```

- [ ] **Step 3: Add `persistCompanion`.** In `lib/firebase/companyData.ts`, next to `persistRoadmapStage`:

```ts
/** Persist the founder's chosen companion character. */
export async function persistCompanion(companyId: string, companionId: string): Promise<void> {
  await updateDoc(doc(getDb(), paths.company(companyId)), {
    companionId,
    updatedAt: Date.now(),
  });
}
```

- [ ] **Step 4: Wire the store.** In `lib/store.tsx`:

Import the persister (extend the existing `companyData` import list) and the default:

```ts
// add to the existing '@/lib/firebase/companyData' import (it's './firebase/companyData' here)
  persistCompanion,
```
```ts
import { DEFAULT_COMPANION_ID } from './companions';
```

Add state beside the other provider state (near `const [installed, setInstalled] = useState(false);`):

```ts
  const [companionId, setCompanionId] = useState<string>(DEFAULT_COMPANION_ID);
```

Add the action (near the other `useCallback` actions):

```ts
  const setCompanion = useCallback(
    (id: string) => {
      setCompanionId(id);
      track('companion.select', { id });
      if (companyId) {
        persistCompanion(companyId, id).catch((err) =>
          console.error('[store] persist companion failed', err),
        );
      }
    },
    [companyId],
  );
```

Hydrate it in the existing load effect — wherever `loadCompanyData` results are applied (the same place `setBrief`/onboardedAt are consumed), add:

```ts
      setCompanionId(data.companionId ?? DEFAULT_COMPANION_ID);
```

Add to the `AppState` interface (near `installed`):

```ts
  /** The founder's chosen companion character id (default 'byte'). */
  companionId: string;
  /** Set the active companion (persists). */
  setCompanion: (id: string) => void;
```

Add both to the context value object (near `installed, setInstalled`):

```ts
      companionId,
      setCompanion,
```

- [ ] **Step 5: Typecheck + full test suite.**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all existing tests still pass.

- [ ] **Step 6: Commit.**

```bash
git add lib/firebase/schema.ts lib/firebase/companyData.ts lib/store.tsx
git commit -m "feat(companions): companionId store state, persistence, hydration"
```

---

### Task 4: Swap the three chrome points

**Files:**
- Modify: `components/Sidebar.tsx:226-234` (companion card)
- Modify: `components/Copilot.tsx:224-231` + `:278` (chat header + thinking line)
- Modify: `components/views/DepartmentDetail.tsx:127` (department header)

**Interfaces:**
- Consumes: `useApp().companionId` (Task 3), `companionById` (Task 1), `<Companion>` (Task 2).

- [ ] **Step 1: Sidebar companion card.** In `components/Sidebar.tsx`, add imports:

```ts
import { Companion } from './Companion';
import { companionById } from '@/lib/companions';
```

Ensure `companionId` is destructured from `useApp()` in the component, then compute `const c = companionById(companionId);`. Replace the card body:

```tsx
      <div className="petcard">
        <Companion id={companionId} size="s28" />
        <div className="meta" style={{ flex: 1 }}>
          <div className="pn">{c.name}</div>
          <div className="lvl">Companion · Lv.3</div>
          <div className="petbar">
            <i />
          </div>
        </div>
      </div>
```

(The `Companion · Lv.3` label is intentionally unchanged — leveling is out of scope.)

- [ ] **Step 2: Chat header + thinking line.** In `components/Copilot.tsx`, add the same two imports, destructure `companionId` from `useApp()`, and compute `const c = companionById(companionId);`. Replace the header avatar + name (`:224-226`):

```tsx
        <Companion id={companionId} size="s28" />
        <div>
          <div className="pn">{c.name}</div>
```

Replace the thinking bubble text (`:278`):

```tsx
                {c.name} is thinking…
```

- [ ] **Step 3: Department header.** In `components/views/DepartmentDetail.tsx`, add the two imports, destructure `companionId` from `useApp()`, and replace the avatar (`:127`):

```tsx
          <Companion id={companionId} size="s28" />
```

(The `{d.byte}` intro string stays as-is; it now reads as the active companion speaking.)

- [ ] **Step 4: Verify build + no unused `Byte` import warnings.**

Run: `npx tsc --noEmit && npx eslint components/Sidebar.tsx components/Copilot.tsx components/views/DepartmentDetail.tsx`
Expected: clean. If `Byte` is now unused in any of these files, remove its import.

- [ ] **Step 5: Commit.**

```bash
git add components/Sidebar.tsx components/Copilot.tsx components/views/DepartmentDetail.tsx
git commit -m "feat(companions): active companion is the face in card, chat, and dept header"
```

---

### Task 5: Shared `<CompanionPicker>` + onboarding step

**Files:**
- Create: `components/CompanionPicker.tsx`
- Modify: `app/globals.css` (append picker styles)
- Modify: `components/Onboarding.tsx` (`STEP_ART` ~36, `OB_TOTAL` usage, reveal button ~541, new step branch)
- Modify: `lib/data.ts:1028` (`OB_TOTAL` 8 → 9)

**Interfaces:**
- Consumes: `COMPANIONS` (Task 1), `<Companion>` (Task 2), `useApp().setCompanion` (Task 3).
- Produces: `<CompanionPicker selected={string} onSelect={(id: string) => void} />`.

- [ ] **Step 1: Create `components/CompanionPicker.tsx`.**

```tsx
'use client';
// The 7-character chooser, reused by onboarding and the in-app switcher.
import { COMPANIONS } from '@/lib/companions';
import { Companion } from './Companion';

export function CompanionPicker({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="cpick">
      {COMPANIONS.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`cpick-cell${c.id === selected ? ' sel' : ''}`}
          aria-pressed={c.id === selected}
          onClick={() => onSelect(c.id)}
        >
          <Companion id={c.id} size="s28" />
          <span className="cpick-name">{c.name}</span>
          <span className="cpick-tone">{c.tone}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Append picker styles to `app/globals.css`.**

```css
/* Companion picker (onboarding step + in-app switcher) */
.cpick {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
}
.cpick-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 10px;
  border: 1px solid var(--line, rgba(0, 0, 0, 0.12));
  border-radius: 12px;
  background: transparent;
  cursor: pointer;
  text-align: center;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.cpick-cell:hover { border-color: var(--accent, #7c5cff); }
.cpick-cell.sel {
  border-color: var(--accent, #7c5cff);
  background: color-mix(in srgb, var(--accent, #7c5cff) 10%, transparent);
}
.cpick-name { font-weight: 600; }
.cpick-tone { font-size: 12px; opacity: 0.7; line-height: 1.3; }
```

- [ ] **Step 3: Bump the step count.** In `lib/data.ts:1028`:

```ts
export const OB_TOTAL = 9;
```

- [ ] **Step 4: Add art for the new step.** In `components/Onboarding.tsx`, append one entry to `STEP_ART` (after the `// 7 summary` line):

```ts
  '/onboarding/ob-team.jpg', // 8 choose companion
```

- [ ] **Step 5: Wire the store hooks in Onboarding.** Extend the `useApp()` destructure (currently `{ onboarding, finishOnboarding, toast, scaffoldFromOnboarding }`) with `companionId, setCompanion`, add the import `import { CompanionPicker } from './CompanionPicker';`, and add local pick state near the other `useState`s:

```ts
  const [pick, setPick] = useState(companionId);
```

- [ ] **Step 6: Make the reveal advance to the picker instead of finishing.** The reveal is the final `else` branch. Change its structure so the reveal is explicit and the picker is the new final branch. Change `} else {` (the reveal branch opener, ~line 493) to:

```tsx
  } else if (step === 7) {
```

and change the reveal's foot (`:541`) from `onClick={finish}` to advance:

```tsx
    foot = <Foot label="Choose your companion" onClick={() => setStep(8)} />;
```

- [ ] **Step 7: Add the picker step branch.** Immediately after the reveal branch (before the closing of the `if/else` chain, i.e. after the `step === 7` block), add:

```tsx
  } else {
    // step 8 — choose the companion that rides along for the project.
    body = (
      <>
        <h2>Choose your companion.</h2>
        <p>Pick who&apos;ll accompany you as you build. You can change this anytime in the sidebar.</p>
        <CompanionPicker selected={pick} onSelect={setPick} />
      </>
    );
    foot = (
      <Foot
        label="Start building"
        onClick={() => {
          setCompanion(pick);
          finish();
        }}
      />
    );
  }
```

- [ ] **Step 8: Format + typecheck + build the onboarding path mentally.**

Run: `npm run format && npx tsc --noEmit`
Expected: no type errors. Confirm the `if (step === 0) … else if (step === 6) … else if (step === 7) … else …` chain now has exactly one branch per step 0–8.

- [ ] **Step 9: Commit.**

```bash
git add components/CompanionPicker.tsx app/globals.css components/Onboarding.tsx lib/data.ts
git commit -m "feat(companions): choose-your-companion onboarding step + shared picker"
```

---

### Task 6: In-app switcher (sidebar companion card → popover)

**Rationale:** The spec named "Settings," but on this branch `SettingsView` is a dev-only screen (gated on `NODE_ENV==='development'`) and unreachable in prod. The sidebar companion card is always visible and the most discoverable surface, so the switcher opens from there. This keeps the choice reversible without depending on the in-flight account-menu work.

**Files:**
- Modify: `components/Sidebar.tsx` (make the card a button that toggles a picker popover)
- Modify: `app/globals.css` (popover styles)

**Interfaces:**
- Consumes: `useApp().companionId` + `setCompanion` (Task 3), `<CompanionPicker>` (Task 5).

- [ ] **Step 1: Add popover state to `Sidebar.tsx`.** Import the picker (`import { CompanionPicker } from './CompanionPicker';`), destructure `setCompanion` from `useApp()`, and add local state:

```ts
  const [pickerOpen, setPickerOpen] = useState(false);
```

- [ ] **Step 2: Make the card open the picker.** Wrap the `.petcard` so it toggles the popover and renders the picker when open:

```tsx
      <div className="petcard-wrap">
        <button
          type="button"
          className="petcard"
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen((o) => !o)}
        >
          <Companion id={companionId} size="s28" />
          <div className="meta" style={{ flex: 1 }}>
            <div className="pn">{c.name}</div>
            <div className="lvl">Companion · Lv.3</div>
            <div className="petbar">
              <i />
            </div>
          </div>
        </button>
        {pickerOpen && (
          <div className="petcard-pop">
            <div className="petcard-pop-h">Choose your companion</div>
            <CompanionPicker
              selected={companionId}
              onSelect={(id) => {
                setCompanion(id);
                setPickerOpen(false);
              }}
            />
          </div>
        )}
      </div>
```

(Replace the previous `<div className="petcard">…</div>` block from Task 4 with this wrapped version. Keep the `Companion`/`companionById` imports and the `c` computation.)

- [ ] **Step 3: Style the popover.** Append to `app/globals.css`:

```css
.petcard-wrap { position: relative; }
.petcard { width: 100%; border: none; background: transparent; cursor: pointer; text-align: left; }
.petcard-pop {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  right: 0;
  padding: 12px;
  border: 1px solid var(--line, rgba(0, 0, 0, 0.12));
  border-radius: 12px;
  background: var(--surface, #fff);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
  z-index: 40;
}
.petcard-pop-h { font-size: 12px; font-weight: 600; opacity: 0.7; margin-bottom: 10px; }
```

- [ ] **Step 4: Format, typecheck, lint.**

Run: `npm run format && npx tsc --noEmit && npx eslint components/Sidebar.tsx`
Expected: clean. (The `.petcard` is now a `<button>`; confirm no nested-button lint issues — the picker cells sit in the popover, a sibling of the card button, not inside it.)

- [ ] **Step 5: Commit.**

```bash
git add components/Sidebar.tsx app/globals.css
git commit -m "feat(companions): in-app switcher from the sidebar companion card"
```

---

### Task 7: Companion voice (chat + deliverables)

**Files:**
- Modify: `lib/ai/chat.ts:39-49` (add `companionId` param + body field)
- Modify: `lib/store.tsx` (`sendChat` passes `companionId`, add to `useCallback` deps)
- Modify: `app/api/chat/route.ts:252` (append `personaOverride`)
- Modify: `lib/ai/runTask.ts` (`RunArgs` + body) and `app/api/run-task/route.ts:203,214` (append `personaOverride`)
- Modify: `lib/store.tsx` run-task call sites (`:862`, `:906`) + `components/artifact/ArtifactModal.tsx` (pass `companionId`)

**Interfaces:**
- Consumes: `personaOverride` (Task 1), `useApp().companionId` (Task 3).

- [ ] **Step 1: Thread `companionId` through the chat client.** In `lib/ai/chat.ts`, add a parameter and body field:

```ts
export async function* streamByteChat(
  history: ChatTurn[],
  deptSummary?: string,
  openTasks?: RunnableTask[],
  envSetup?: SetupItem[],
  companionId?: string,
): AsyncGenerator<ChatEvent> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ messages: history, deptSummary, openTasks, envSetup, companionId }),
  });
```

- [ ] **Step 2: Pass it from the store.** In `lib/store.tsx` `sendChat`, update the call (`:1061`):

```ts
          for await (const ev of streamByteChat(history, deptSummary, openTasks, envSetup, companionId)) {
```

Add `companionId` to the `sendChat` `useCallback` dependency array.

- [ ] **Step 3: Apply the persona in the chat route.** In `app/api/chat/route.ts`, import the helper (`import { personaOverride } from '@/lib/companions';`) and change the system assembly (`:252`):

```ts
  const system = `${BYTE_SYSTEM}\n\nThe founder's company: ${context}${relevantBlock}${deptSummary}${runnableBlock}${setupBlock}${personaOverride(body.companionId as string | undefined)}`;
```

(Confirm the route reads its JSON body into `body`; if it destructures fields instead, read `companionId` the same way the others are read.)

- [ ] **Step 4: Thread `companionId` through the run-task client.** In `lib/ai/runTask.ts`, add `companionId?: string` to the `RunArgs` interface. It is already serialized wholesale (`body: JSON.stringify(args)`), so no other change is needed there.

- [ ] **Step 5: Apply the persona in the run-task route.** In `app/api/run-task/route.ts`, import `personaOverride`, read `companionId` from the parsed body, and at BOTH `system:` spots (`:203`, `:214`) use:

```ts
        system: BYTE_SYSTEM + personaOverride(companionId),
```

- [ ] **Step 6: Pass `companionId` at the store run-task call sites.** In `lib/store.tsx` (`:862` and `:906`), add `companionId,` to each `runByteTask({ … })` argument object.

- [ ] **Step 7: Pass `companionId` from the department panel.** In `components/artifact/ArtifactModal.tsx`, destructure `companionId` from `useApp()` and add `companionId` to its `runByteTask({ … })` call(s). (Grep for `runByteTask(` in that file to find them.)

- [ ] **Step 8: Format, typecheck, full test suite.**

Run: `npm run format && npx tsc --noEmit && npx vitest run`
Expected: clean; all tests pass.

- [ ] **Step 9: Commit.**

```bash
git add lib/ai/chat.ts lib/ai/runTask.ts app/api/chat/route.ts app/api/run-task/route.ts lib/store.tsx components/artifact/ArtifactModal.tsx
git commit -m "feat(companions): active companion speaks in its own voice in chat + deliverables"
```

---

## Final verification (on the Vercel PR preview)

Local `next dev` is unreliable in the symlinked worktree and first-run is unreadable there, so verify on the preview build:

- [ ] Onboard a fresh company → the new **Choose your companion** step appears as the last step; picking **Luna** and pressing *Start building* lands in the app with Luna in the sidebar card, the chat header, and a department header.
- [ ] Open the chat and send a message → the reply reads in Luna's first-person voice (not "byte"); the thinking line says "Luna is thinking…".
- [ ] Click the sidebar companion card → the switcher opens; pick **Null** → all three chrome points update immediately.
- [ ] Reload → the choice persists (hydrated from Firestore).
- [ ] Keep **byte** (default) for a second account → nothing about today's behaviour or voice changes.
- [ ] `npm run format:check` passes before pushing.

## Self-Review

- **Spec coverage:** Roster (Task 1) · `<Companion>` + art intake (Tasks 1–2) · choice at onboarding, switchable, persisted, default byte (Tasks 3, 5, 6) · replaces byte at card/chat/dept (Task 4) · voice via one prepended line, zero extra calls (Task 7) · leveling/memory/toolkit/departments explicitly untouched (Global Constraints). The spec's "switcher in Settings" is deliberately relocated to the sidebar card (Task 6 rationale) because Settings is dev-gated on this branch.
- **Placeholder scan:** none — every step ships real code/commands.
- **Type consistency:** `companionById`/`personaOverride`/`COMPANIONS`/`DEFAULT_COMPANION_ID` (Task 1) are used with those exact names in Tasks 2–7; `companionId`/`setCompanion` (Task 3) match every consumer; `persistCompanion(companyId, companionId)` signature matches its call in the store.
