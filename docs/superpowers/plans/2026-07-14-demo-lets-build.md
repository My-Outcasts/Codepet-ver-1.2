# Demo "Let's build" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A default-ON `demoLetsBuild` Settings toggle that makes "Let's build" target a self-seeding throwaway landing page at `~/codepet-demo` (with a pre-filled suggested brief), so teammates can try the real build flow safely.

**Architecture:** Client toggle in the store (localStorage, default true). When on, `armBuild` skips project selection and targets `~/codepet-demo`: in local mode a server action scaffolds+seeds the dir; in remote mode the copy-paste command self-seeds it (base64). Intake pre-fills a demo brief. A banner marks demo mode. Real `claude` engine unchanged.

**Tech Stack:** Next.js/React, server actions (fs/spawn), Vitest. TDD for the pure command helper; build+lint+typecheck for the rest.

## Global Constraints

- Toggle default is **ON** (unset localStorage → true).
- Demo dir is exactly `~/codepet-demo` (home-relative in shell; `os.homedir()`-joined in Node).
- Seed `index.html` **only if missing** — re-runs must preserve byte's earlier work.
- When the toggle is OFF, "Let's build" behaves exactly as today (real project pick).
- Real build engine / live-session protocol unchanged.
- Keep the build clean: `npm run typecheck` clean, `npm run lint` no new errors, `npm test` green (incl. a new `demoTerminalCommand` test).

## File Structure

- **Modify** `lib/armSession.ts` — `DEMO_DIR`, `DEMO_SEED_HTML`, `demoTerminalCommand()`.
- **Modify** `lib/armSession.test.ts` — test `demoTerminalCommand`.
- **Modify** `lib/buildFlow.ts` — `DEMO_BUILD_BRIEF`.
- **Modify** `app/actions/build.ts` — `scaffoldDemoProject()` server action.
- **Modify** `lib/store.tsx` — `demoLetsBuild` state/setter/context; `armBuild` demo branch; `startBuildIntake` pre-fill.
- **Modify** `components/views/SettingsView.tsx` — the toggle card.
- **Modify** `components/views/BuildCoachView.tsx` — the demo banner.

---

### Task 1: `demoTerminalCommand` + demo constants (TDD)

**Files:**
- Modify: `lib/armSession.ts`
- Test: `lib/armSession.test.ts`

**Interfaces:**
- Produces: `export const DEMO_DIR = '~/codepet-demo'`; `export const DEMO_SEED_HTML: string`; `export function demoTerminalCommand(prompt: string): string`.

- [ ] **Step 1: Write the failing test**

Append to `lib/armSession.test.ts`:
```ts
import { demoTerminalCommand, DEMO_DIR } from './armSession';

describe('demoTerminalCommand', () => {
  it('creates the demo dir, seeds index.html only if missing, then runs claude', () => {
    const cmd = demoTerminalCommand('build a landing page');
    expect(cmd).toContain('mkdir -p ~/codepet-demo');
    expect(cmd).toContain('cd ~/codepet-demo');
    expect(cmd).toContain('[ -f index.html ]'); // guard: only seed when missing
    expect(cmd).toContain('base64 -d > index.html');
    expect(cmd).toContain('claude "build a landing page"');
  });
  it('exposes the demo dir constant', () => {
    expect(DEMO_DIR).toBe('~/codepet-demo');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/armSession.test.ts`
Expected: FAIL — `demoTerminalCommand`/`DEMO_DIR` are not exported.

- [ ] **Step 3: Implement**

In `lib/armSession.ts` (reuse the existing `shq` helper the file already has), add:
```ts
export const DEMO_DIR = '~/codepet-demo';

// A minimal but real starter landing page — byte builds this out during the demo.
export const DEMO_SEED_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Demo — built with Codepet</title>
  </head>
  <body>
    <!-- Starter page. byte will build this out. -->
    <main>
      <h1>Coming soon</h1>
      <p>This page is a throwaway demo target for Codepet's "Let's build".</p>
    </main>
  </body>
</html>
`;

// A single copy-paste command (remote mode): make the demo dir, seed index.html only if
// it's missing (so re-runs keep byte's progress), then run the real claude session.
// The seed is base64-embedded to avoid shell-escaping the HTML.
export function demoTerminalCommand(prompt: string): string {
  const b64 = btoa(unescape(encodeURIComponent(DEMO_SEED_HTML)));
  return (
    `mkdir -p ${DEMO_DIR} && cd ${DEMO_DIR} && ` +
    `{ [ -f index.html ] || echo '${b64}' | base64 -d > index.html; } && ` +
    `claude "${shq(prompt)}"`
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/armSession.test.ts`
Expected: PASS (existing `terminalCommand` tests still green too).

- [ ] **Step 5: Typecheck + lint + commit**

```bash
npm run typecheck && npx eslint lib/armSession.ts lib/armSession.test.ts
git add lib/armSession.ts lib/armSession.test.ts
git commit -m "feat(build): demoTerminalCommand + demo landing-page seed for demo Let's build"
```

---

### Task 2: `scaffoldDemoProject` server action + `DEMO_BUILD_BRIEF`

**Files:**
- Modify: `app/actions/build.ts`
- Modify: `lib/buildFlow.ts`

**Interfaces:**
- Produces: `export async function scaffoldDemoProject(): Promise<string>` (returns the absolute demo dir, seeded); `export const DEMO_BUILD_BRIEF: string`.
- Consumes: `DEMO_SEED_HTML` from `lib/armSession.ts` (Task 1).

- [ ] **Step 1: Add the demo brief constant**

In `lib/buildFlow.ts` (beside `INTAKE_OPENING`), add:
```ts
export const DEMO_BUILD_BRIEF =
  'A simple landing page for a neighborhood coffee shop — a warm hero with the name and tagline, three menu highlights, opening hours, and a "Visit us" call-to-action.';
```

- [ ] **Step 2: Add the scaffold action**

In `app/actions/build.ts`, add `os` to the node imports and the `DEMO_SEED_HTML` import, then append:
```ts
import os from 'node:os';
import { buildOpeningPrompt, terminalCommand, DEMO_SEED_HTML } from '@/lib/armSession';
```
(merge with the existing `@/lib/armSession` import) and:
```ts
/** Create + seed the throwaway demo project on the local machine (local mode only —
 *  in remote mode the copy-paste command seeds it instead). Returns the absolute dir.
 *  Seeds index.html only if missing, so re-runs keep byte's earlier work. */
export async function scaffoldDemoProject(): Promise<string> {
  const dir = path.join(os.homedir(), 'codepet-demo');
  fs.mkdirSync(dir, { recursive: true });
  const index = path.join(dir, 'index.html');
  if (!fs.existsSync(index)) fs.writeFileSync(index, DEMO_SEED_HTML);
  return dir;
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck && npx eslint app/actions/build.ts lib/buildFlow.ts
git add app/actions/build.ts lib/buildFlow.ts
git commit -m "feat(build): scaffoldDemoProject action + demo build brief"
```

---

### Task 3: `demoLetsBuild` state + `armBuild` demo branch + intake pre-fill

**Files:**
- Modify: `lib/store.tsx`

**Interfaces:**
- Consumes: `demoTerminalCommand`, `DEMO_DIR` (Task 1); `scaffoldDemoProject` (Task 2); `DEMO_BUILD_BRIEF` (Task 2).
- Produces on the store context: `demoLetsBuild: boolean`, `setDemoLetsBuild: (v: boolean) => void`.

- [ ] **Step 1: Imports**

Add to the existing imports in `lib/store.tsx`:
```ts
import { buildOpeningPrompt, terminalCommand, demoTerminalCommand, DEMO_DIR } from './armSession';
```
(merge with the existing `./armSession` import), and:
```ts
import { scaffoldDemoProject } from '@/app/actions/build';
```
(merge with the existing `@/app/actions/build` import — it already imports `armBuildSession`), and add `DEMO_BUILD_BRIEF` to the existing `./buildFlow` import (which already imports `INTAKE_OPENING`).

- [ ] **Step 2: Add the state + setter**

Near the other build state (`const [buildProject, setBuildProject] = useState(...)`), add:
```ts
  const [demoLetsBuild, setDemoLetsBuildState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem('codepet:demoLetsBuild') !== '0'; // default ON
  });
  const setDemoLetsBuild = useCallback((v: boolean) => {
    setDemoLetsBuildState(v);
    if (typeof window !== 'undefined')
      window.localStorage.setItem('codepet:demoLetsBuild', v ? '1' : '0');
  }, []);
```

- [ ] **Step 3: Declare them on the store interface**

In the store's context interface (beside `buildProject: string;`), add:
```ts
  demoLetsBuild: boolean;
  setDemoLetsBuild: (v: boolean) => void;
```

- [ ] **Step 4: Pre-fill the intake brief in demo mode**

In `startBuildIntake`, change `setBuildBrief('');` to:
```ts
    setBuildBrief(demoLetsBuild ? DEMO_BUILD_BRIEF : '');
```
and add `demoLetsBuild` to its `useCallback` dependency array.

- [ ] **Step 5: Add the demo branch in `armBuild`**

Relax the guard and add a demo branch. Replace the current `armBuild` body's guard + `try` interior so it reads:
```ts
  const armBuild = useCallback(() => {
    if (!buildPlan || !companyId || buildArming || (!demoLetsBuild && !buildProject.trim())) return;
    setBuildArming(true);
    buildEndedNudged.current = false;
    setBuildResumed(false);
    (async () => {
      try {
        const id = crypto.randomUUID();
        if (demoLetsBuild) {
          const cap = await getCapability();
          if (cap.mode === 'local') {
            const dir = await scaffoldDemoProject(); // creates + seeds ~/codepet-demo
            setBuildProjectDir(dir);
            setBuildCheckpoint(null); // throwaway target — no rewind
            setBuildLocal(true);
            setBuildLaunchCommand(null);
            setBuildSessionId(id);
            setBuildLive(null);
            setBuildStep('during');
          } else {
            setBuildLocal(false);
            setBuildProjectDir(DEMO_DIR);
            const token = await ensureIngestToken(companyId);
            await armBuildSession({
              buildSessionId: id,
              projectDir: DEMO_DIR,
              plan: buildPlan,
              brief: buildBrief,
              companyId,
              token,
              apiUrl: window.location.origin,
            });
            // Self-seeding copy-paste command (the app can't touch the tester's machine remotely).
            setBuildLaunchCommand(demoTerminalCommand(buildOpeningPrompt(buildPlan, buildBrief)));
            setBuildSessionId(id);
            setBuildLive(null);
            setBuildStep('during');
          }
        } else {
          const dirs = await loadProjectDirs(companyId);
          const dir = dirs.find((p) => p.name === buildProject)?.path ?? buildProject.trim();
          setBuildProjectDir(dir);
          const cap = await getCapability();
          if (cap.mode === 'local') {
            setBuildCheckpoint(await createCheckpoint(dir));
            setBuildLocal(true);
            setBuildLaunchCommand(null);
            setBuildSessionId(id);
            setBuildLive(null);
            setBuildStep('during');
          } else {
            setBuildLocal(false);
            const command = terminalCommand(dir, buildOpeningPrompt(buildPlan, buildBrief));
            const token = await ensureIngestToken(companyId);
            const res = await armBuildSession({
              buildSessionId: id,
              projectDir: dir,
              plan: buildPlan,
              brief: buildBrief,
              companyId,
              token,
              apiUrl: window.location.origin,
            });
            setBuildLaunchCommand(res.ok && res.launched ? null : command);
            setBuildSessionId(id);
            setBuildLive(null);
            setBuildStep('during');
          }
        }
        setView('build');
        const live: ChatMessage = {
          id: newId(),
          role: 'byte',
          text: "We're live! I'm watching your session in the main panel — every step lands there. 👀",
          ts: Date.now(),
        };
        setChatMessages((prev) => [...prev, live]);
        persistMsg({ id: live.id, role: 'byte', text: live.text, ts: live.ts });
        track('build.arm', { demo: demoLetsBuild });
      } finally {
        setBuildArming(false);
      }
    })();
  }, [buildPlan, companyId, buildArming, buildProject, buildBrief, demoLetsBuild, persistMsg]);
```

- [ ] **Step 6: Expose on the context value**

Add `demoLetsBuild,` and `setDemoLetsBuild,` to BOTH the provider `value` object and its dependency array (the same two places `buildProject`/`setBuildProject` appear).

- [ ] **Step 7: Typecheck + lint + commit**

```bash
npm run typecheck && npx eslint lib/store.tsx
git add lib/store.tsx
git commit -m "feat(build): demoLetsBuild store state + armBuild demo branch + intake pre-fill"
```

---

### Task 4: Settings toggle + demo banner

**Files:**
- Modify: `components/views/SettingsView.tsx`
- Modify: `components/views/BuildCoachView.tsx`

**Interfaces:**
- Consumes: `demoLetsBuild`, `setDemoLetsBuild` from the store (Task 3).

- [ ] **Step 1: Settings toggle card**

In `SettingsView`, read the store values (`const { demoLetsBuild, setDemoLetsBuild } = useApp();`) and add a `set-card` (not dev-gated) using the same `role="switch"` pattern as the existing tracking toggle:
```tsx
        <div className="set-card">
          <div className="set-row">
            <div className="set-txt">
              <b>Demo Let&apos;s build</b>
              <span>
                Builds a throwaway landing page in <code>~/codepet-demo</code> instead of your
                real project — for trying the feature safely. On by default.
              </span>
            </div>
            <button
              role="switch"
              aria-checked={demoLetsBuild}
              aria-label="Demo Let's build"
              className={`switch${demoLetsBuild ? ' on' : ''}`}
              onClick={() => setDemoLetsBuild(!demoLetsBuild)}
            >
              <span className="knob" />
            </button>
          </div>
        </div>
```

- [ ] **Step 2: Demo banner in the build view**

In `BuildCoachView`, read `demoLetsBuild` from the store and, when true, render a small calm banner near the top of the build/during view:
```tsx
      {demoLetsBuild && (
        <div
          style={{
            margin: '8px 0',
            padding: '7px 12px',
            borderRadius: 9,
            fontSize: 12.5,
            background: 'rgba(125,227,255,0.08)',
            border: '1px solid rgba(125,227,255,0.3)',
            color: 'var(--t-2, #cfe0ff)',
          }}
        >
          Demo mode — building a throwaway landing page in <code>~/codepet-demo</code>. Your real
          projects are untouched.
        </div>
      )}
```
(Place it where it renders in the build view regardless of local/remote; match the file's existing structure — if `BuildCoachView` composes sub-panels, put it in the shared wrapper.)

- [ ] **Step 3: Typecheck + lint + build**

```bash
npm run typecheck && npx eslint components/views/SettingsView.tsx components/views/BuildCoachView.tsx && npm run build
```
Expected: clean; build succeeds.

- [ ] **Step 4: Visual check**

`npm run dev`, open Settings → the **Demo Let's build** toggle is **ON** by default and persists across reload. Start "Let's build": the intake brief is pre-filled with the coffee-shop landing page, the build view shows the demo banner, and arming yields (remote) a single copy-paste command containing `mkdir -p ~/codepet-demo` + `base64 -d > index.html` + `claude`. Toggle OFF → the flow requires a real project again.

- [ ] **Step 5: Commit**

```bash
git add components/views/SettingsView.tsx components/views/BuildCoachView.tsx
git commit -m "feat(build): Demo Let's build Settings toggle + build-view banner"
```

---

## Final verification

- [ ] `npm run typecheck && npm run lint && npm test && npm run build` — all pass; no new lint errors; `demoTerminalCommand` test green.
- [ ] Toggle default ON, persists; demo build targets `~/codepet-demo`, seeds `index.html` only if missing; pre-filled brief; banner shows; OFF restores today's behavior.

## Self-Review Notes

- **Spec coverage:** toggle default-ON + persistence (T3 S2, T4 S1); demo dir + self-seeding command (T1) + local scaffold action (T2); armBuild demo branch local/remote (T3 S5); pre-filled brief (T2 S1 + T3 S4); banner (T4 S2). Covered.
- **Placeholder scan:** none — concrete code throughout.
- **Type consistency:** `DEMO_DIR`/`demoTerminalCommand`/`DEMO_SEED_HTML` (T1) consumed in T2/T3; `scaffoldDemoProject` returns the abs dir consumed by T3's local branch; `demoLetsBuild`/`setDemoLetsBuild` declared (T3 S3) and consumed in T4.
