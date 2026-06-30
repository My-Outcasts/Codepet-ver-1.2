# First Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "first install" view under the sidebar's "Your setup" group that animates waking byte up, really turns on the recommended skills/agents in `ENV`, and remembers it was installed.

**Architecture:** A new `install` view added to the existing in-place-mutation store model. Clicking "wake byte up" runs a staged `setTimeout` animation that flips recommended `ENV` skills/agents to active and persists an `installed` flag in `localStorage`. The view renders a fresh animated flow when not installed and a static recap when it is.

**Tech Stack:** Next.js 16, React 19, TypeScript, plain CSS in `app/globals.css`. No test runner exists in this repo.

## Global Constraints

- This repo has **no test framework** (package.json scripts: `dev`, `build`, `start`, `lint`). Per-task verification = `yarn build` must succeed (Next.js typechecks + compiles) plus a manual visual check via `yarn dev`.
- Match the existing **light/warm** design language (tokens `--accent`, `--surface`, `--t-1`, `--hairline`, etc.) — do NOT port the demo's dark theme.
- App label for the pet is lowercase **byte** everywhere.
- `ENV` (in `lib/data.ts`) is mutated in place; after any mutation call `bump()` so consumers re-read.
- `localStorage` key: `codepet:installed`, value `'1'`. All `localStorage` access wrapped in try/catch.
- Reuse the existing `<Byte>` component and `.view`/`.vhead` view scaffolding.

---

### Task 1: Store — `install` view, `installed` state, persistence

**Files:**
- Modify: `lib/store.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces (on `useApp()`):
  - `View` union now includes `'install'`.
  - `installed: boolean` — hydrated from `localStorage['codepet:installed']` after mount.
  - `markInstalled: () => void` — sets `installed=true` and writes `localStorage['codepet:installed']='1'`.

- [ ] **Step 1: Add `'install'` to the View union**

In `lib/store.tsx`, change the `View` type (currently line ~9):

```tsx
export type View = 'home' | 'roadmap' | 'dept' | 'tasks' | 'library' | 'env' | 'install';
```

- [ ] **Step 2: Import `useEffect`**

Change the React import line (currently line ~5) to include `useEffect`:

```tsx
import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
```

- [ ] **Step 3: Add `installed` / `markInstalled` to the `AppState` interface**

In the `AppState` interface, next to `onboarding`/`finishOnboarding`, add:

```tsx
  installed: boolean;
  markInstalled: () => void;
```

- [ ] **Step 4: Add state, hydration effect, and the action in `AppProvider`**

After the existing `const [onboarding, setOnboarding] = useState(true);` line, add:

```tsx
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    try { if (localStorage.getItem('codepet:installed') === '1') setInstalled(true); } catch {}
  }, []);
```

Then, near the other `useCallback` actions (e.g. after `finishOnboarding`), add:

```tsx
  const markInstalled = useCallback(() => {
    setInstalled(true);
    try { localStorage.setItem('codepet:installed', '1'); } catch {}
  }, []);
```

- [ ] **Step 5: Expose them on the context value**

In the `value = useMemo<AppState>(() => ({ ... }))` object, add `installed, markInstalled,` (e.g. after `finishOnboarding,`). Then add `installed, markInstalled` to the `useMemo` dependency array as well (both the object and the deps array must list them).

- [ ] **Step 6: Verify it builds**

Run: `yarn build`
Expected: build succeeds with no TypeScript errors. (If `next build` complains about an unused symbol, that's fine to ignore only if it's a warning, not an error — but there should be none.)

- [ ] **Step 7: Commit**

```bash
git add lib/store.tsx
git commit -m "feat: add install view + installed flag to store

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Sidebar — "First install" menu item

**Files:**
- Modify: `components/Sidebar.tsx`
- Modify: `app/globals.css` (two small badge rules)

**Interfaces:**
- Consumes: `installed`, `view`, `show` from `useApp()`; `view === 'install'`.
- Produces: a clickable nav entry that calls `show('install')`.

- [ ] **Step 1: Pull `installed` out of the store**

In `components/Sidebar.tsx`, change the destructure (currently line ~14):

```tsx
  const { view, show, library, tick, installed } = useApp();
```

- [ ] **Step 2: Render the install item above Environment**

Replace the existing `<div className="grp">Your setup</div>` block (the `grp` div plus the `item('env', ...)` call) with:

```tsx
      <div className="grp">Your setup</div>
      <div className={`nav${view === 'install' ? ' on' : ''}`} onClick={() => show('install')}>
        <svg className="ic" viewBox="0 0 20 20" fill="none"><path d="M11 2L4 11h5l-1 7 7-9h-5l1-7z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
        <span>First install</span>
        {installed ? <span className="nav-ck">✓</span> : <span className="nav-dot" />}
      </div>
      {item('env', 'Environment',
        <svg className="ic" viewBox="0 0 20 20" fill="none"><path d="M3 6h14M3 14h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><circle cx="8" cy="6" r="2.3" fill="var(--surface)" stroke="currentColor" strokeWidth="1.6" /><circle cx="12" cy="14" r="2.3" fill="var(--surface)" stroke="currentColor" strokeWidth="1.6" /></svg>,
        envPending || undefined)}
```

(Only the `install` nav block is new; the `item('env', ...)` call is unchanged — shown here for placement context.)

- [ ] **Step 3: Add the badge CSS**

In `app/globals.css`, append near the other sidebar `.nav` rules (anywhere in the file is fine — the install section in Task 3 also adds rules):

```css
  .nav .nav-dot{margin-left:auto;width:7px;height:7px;border-radius:50%;background:var(--gold)}
  .nav .nav-ck{margin-left:auto;font-size:11px;color:var(--accent-deep)}
```

- [ ] **Step 4: Verify it builds**

Run: `yarn build`
Expected: build succeeds. (The view won't render content yet — Task 3 wires the component — but `show('install')` falls through to `<EnvironmentView />` in AppRoot until then, so nothing crashes.)

- [ ] **Step 5: Commit**

```bash
git add components/Sidebar.tsx app/globals.css
git commit -m "feat: add First install menu under Your setup

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Install view — animated setup + recap + wiring + styles

**Files:**
- Create: `components/views/InstallView.tsx`
- Modify: `components/AppRoot.tsx` (import + switch entry)
- Modify: `app/globals.css` (install styles)

**Interfaces:**
- Consumes: `installed`, `markInstalled`, `bump`, `tick`, `show` from `useApp()`; mutates `ENV.skills`, `ENV.agents`, `ENV.connectors` (each item has `{ n: string; ab: string; s: number; rec?: 1 }`).
- Produces: the `InstallView` React component, rendered when `view === 'install'`.

- [ ] **Step 1: Create the InstallView component**

Create `components/views/InstallView.tsx` with exactly:

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/store';
import { ENV } from '@/lib/data';
import { Byte } from '../Byte';

export function InstallView() {
  const { installed, markInstalled, bump, tick, show } = useApp();
  void tick; // re-read mutable ENV on each store change

  const [started, setStarted] = useState(false);
  const [s1, setS1] = useState(false); // toolkit unpacked
  const [s2, setS2] = useState(false); // byte awake (complete)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const runSetup = () => {
    setStarted(true); setS1(false); setS2(false);
    timers.current.forEach(clearTimeout); timers.current = [];
    timers.current.push(setTimeout(() => {
      ['skills', 'agents'].forEach((k) => ENV[k].forEach((x) => { if (x.rec) x.s = 1; }));
      setS1(true); bump();
    }, 700));
    timers.current.push(setTimeout(() => {
      setS2(true); markInstalled();
    }, 1600));
  };

  const packSkills = ENV.skills.filter((x) => x.rec).map((x) => x.n);
  const packAgents = ENV.agents.filter((x) => x.rec).map((x) => x.n);
  const connectors = ENV.connectors.filter((x) => x.n === 'GitHub' || x.n === 'Notion');
  const connect = (x: { s: number }) => { x.s = 1; bump(); };

  // Recap: installed on a previous visit and not currently re-running.
  if (installed && !started) {
    const onSkills = ENV.skills.filter((x) => x.s);
    const onAgents = ENV.agents.filter((x) => x.s);
    const onConn = ENV.connectors.filter((x) => x.s);
    return (
      <section className="view on" id="v-install">
        <div className="vhead"><h1>byte is ready</h1><div className="sub">Your toolkit is set up. byte can already do real work with you.</div></div>
        <div className="install">
          <div className="ins-hero">
            <Byte size="s56" className="cheer" />
            <div className="ins-h-txt"><b>byte&apos;s awake and ready 🎉</b><span>{onSkills.length} skills · {onAgents.length} agents · {onConn.length} connectors active</span></div>
          </div>
          <div className="ins-recap">
            <div className="ins-rcol"><div className="ins-rh">Skills</div>{onSkills.map((x) => <div className="ins-ri" key={x.n}><span className="ck">✓</span>{x.n}</div>)}</div>
            <div className="ins-rcol"><div className="ins-rh">Agents</div>{onAgents.map((x) => <div className="ins-ri" key={x.n}><span className="ck">✓</span>{x.n}</div>)}</div>
            <div className="ins-rcol"><div className="ins-rh">Connectors</div>{onConn.length ? onConn.map((x) => <div className="ins-ri" key={x.n}><span className="ck">✓</span>{x.n}</div>) : <div className="ins-ri muted">None yet</div>}</div>
          </div>
          <div className="ins-acts">
            <button className="ins-link" onClick={runSetup}>Re-run setup</button>
            <button className="ins-link" onClick={() => show('env')}>Manage in Environment →</button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="view on" id="v-install">
      <div className="vhead"><h1>Let&apos;s wake byte up</h1><div className="sub">One click sets up byte&apos;s toolkit so it can start building with you.</div></div>
      <div className="install">
        <div className="ins-hero">
          <Byte size="s56" className={s2 ? 'cheer' : ''} />
          <div className="ins-h-txt">
            <b>{s2 ? 'byte’s awake! 🎉' : 'Hi, I’m byte 🐣'}</b>
            <span>{s2 ? 'Ready to play: track tokens + plan with you' : 'One tap and I’ll wake right up'}</span>
          </div>
        </div>

        <button className="ins-btn" disabled={started && !s2} onClick={runSetup}>
          {!started ? '▶ Wake byte up' : !s2 ? 'Setting up…' : '✓ Toolkit ready'}
        </button>

        <div className={`ins-row${started ? ' on' : ''}${s1 ? ' ok' : ''}`}>
          <span className="ins-ic">{s1 ? '✓' : '○'}</span>
          <div className="ins-meta"><b>Unpacking byte&apos;s toolkit…</b><span>pulling out the skills you need to build</span></div>
        </div>

        <div className={`ins-pack${s1 ? ' on' : ''}`}>
          <div className="ins-pk-h">byte&apos;s toolkit ✨</div>
          <div className="ins-chips">
            {packSkills.map((n) => <span className="ins-chip s" key={n}>skill: {n}</span>)}
            {packAgents.map((n) => <span className="ins-chip a" key={n}>agent: {n}</span>)}
            <span className="ins-chip c">statusline: tokens</span>
            <span className="ins-chip c">hook: session-start</span>
          </div>
        </div>

        <div className={`ins-row${s1 ? ' on' : ''}${s2 ? ' ok' : ''}`}>
          <span className="ins-ic">{s2 ? '✓' : '○'}</span>
          <div className="ins-meta"><b>byte&apos;s awake! 🎉</b><span>ready to track tokens + brainstorm with you</span></div>
          {s2 && <span className="ins-tag">ready</span>}
        </div>

        <div className="ins-opt-h">Connect these later — no rush</div>
        {connectors.map((x) => (
          <div className="ins-conn" key={x.n}>
            <span className="ins-conn-ic">{x.ab}</span>
            <div className="ins-meta"><b>{x.n}</b></div>
            {x.s
              ? <span className="ins-conn-on"><span className="ck">✓</span>Connected</span>
              : <button className="ins-conn-btn" onClick={() => connect(x)}>Connect</button>}
          </div>
        ))}

        <button className="ins-skip" onClick={() => show('env')}>Skip → see the full Environment</button>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Wire it into AppRoot**

In `components/AppRoot.tsx`, add the import alongside the other view imports:

```tsx
import { InstallView } from './views/InstallView';
```

Then in the `ActiveView` ternary chain, add the `install` branch before the final `EnvironmentView` fallback:

```tsx
  const ActiveView =
    view === 'home' ? <CompanyView />
    : view === 'roadmap' ? <RoadmapView />
    : view === 'dept' ? <DepartmentDetail />
    : view === 'tasks' ? <TasksView />
    : view === 'library' ? <LibraryView />
    : view === 'install' ? <InstallView />
    : <EnvironmentView />;
```

- [ ] **Step 3: Add the install styles**

In `app/globals.css`, append this block (keep it near the existing `.env-*` rules for cohesion):

```css
  /* ===== first install ===== */
  .install{padding:8px 26px 40px;max-width:640px}
  .ins-hero{display:flex;align-items:center;gap:16px;background:color-mix(in srgb,var(--accent) 8%,var(--surface));border:1px solid color-mix(in srgb,var(--accent) 20%,transparent);border-radius:14px;padding:16px 18px;margin-bottom:18px}
  .ins-h-txt b{display:block;font-size:15px;color:var(--t-1);margin-bottom:3px}
  .ins-h-txt span{font-size:12.5px;color:var(--t-3)}
  .byte.cheer .bimg{animation:hop .5s ease-in-out infinite}
  .ins-btn{display:block;width:100%;padding:13px;margin-bottom:16px;border:none;border-radius:11px;background:var(--accent);color:#fff;font-size:14.5px;font-weight:600;font-family:var(--sans);cursor:pointer;transition:.15s}
  .ins-btn:hover{background:var(--accent-deep)}
  .ins-btn:disabled{opacity:.55;cursor:default;background:var(--accent)}
  .ins-row{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--hairline);border-radius:11px;margin-bottom:9px;opacity:.4;transition:.35s}
  .ins-row.on{opacity:1}
  .ins-row.ok{border-color:var(--accent-line);background:var(--accent-tint)}
  .ins-ic{width:20px;text-align:center;font-size:15px;flex:none;color:var(--t-4)}
  .ins-row.ok .ins-ic{color:var(--accent-deep)}
  .ins-meta{flex:1}.ins-meta b{font-size:13.5px;font-weight:600;color:var(--t-1)}
  .ins-meta span{display:block;font-size:11.5px;color:var(--t-4);margin-top:2px}
  .ins-tag{font-size:10px;font-weight:700;padding:3px 9px;border-radius:99px;background:var(--accent-tint);color:var(--accent-deep)}
  .ins-pack{background:var(--surface-2);border:1px solid var(--hairline);border-radius:12px;padding:13px;margin-bottom:9px;opacity:.4;transition:.35s}
  .ins-pack.on{opacity:1}
  .ins-pk-h{font-family:var(--pixel);font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:var(--t-4);margin-bottom:10px}
  .ins-chips{display:flex;flex-wrap:wrap;gap:7px}
  .ins-chip{font-size:11.5px;padding:5px 10px;border-radius:8px;background:var(--surface);border:1px solid var(--hairline);color:var(--t-3)}
  .ins-chip.s{color:var(--accent-deep);background:var(--accent-tint);border-color:var(--accent-line)}
  .ins-chip.a{color:var(--blue);background:var(--blue-tint);border-color:var(--blue-line)}
  .ins-chip.c{color:var(--gold-deep);background:var(--gold-tint);border-color:var(--gold-line)}
  .ins-opt-h{font-family:var(--pixel);font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:var(--t-4);margin:18px 2px 11px}
  .ins-conn{display:flex;align-items:center;gap:12px;padding:11px 14px;border:1px solid var(--hairline);border-radius:11px;margin-bottom:9px}
  .ins-conn-ic{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;font-family:var(--pixel);font-size:10px;font-weight:600;background:var(--well);color:var(--t-2);flex:none}
  .ins-conn-btn{font-size:12px;font-weight:600;border:1px solid var(--blue-line);background:var(--surface);color:var(--blue);border-radius:8px;padding:6px 15px;cursor:pointer;transition:.14s}
  .ins-conn-btn:hover{background:var(--blue);border-color:var(--blue);color:#fff}
  .ins-conn-on{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:500;color:var(--t-3)}
  .ins-conn-on .ck,.ins-ri .ck{width:18px;height:18px;border-radius:50%;background:var(--accent);color:#fff;display:grid;place-items:center;font-size:10px;font-weight:700;flex:none}
  .ins-skip{display:block;width:100%;text-align:center;margin-top:14px;background:none;border:none;font-size:12.5px;color:var(--t-3);text-decoration:underline;cursor:pointer;font-family:var(--sans)}
  .ins-skip:hover{color:var(--t-1)}
  .ins-recap{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px}
  .ins-rcol{background:var(--surface);border:1px solid var(--hairline);border-radius:12px;padding:13px}
  .ins-rh{font-family:var(--pixel);font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:var(--t-4);margin-bottom:10px}
  .ins-ri{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--t-2);padding:4px 0}
  .ins-ri.muted{color:var(--t-4)}
  .ins-acts{display:flex;gap:18px}
  .ins-link{background:none;border:none;font-size:13px;font-weight:600;color:var(--accent-deep);cursor:pointer;font-family:var(--sans)}
  .ins-link:hover{text-decoration:underline}
```

- [ ] **Step 4: Verify it builds**

Run: `yarn build`
Expected: build succeeds, no TypeScript errors.

- [ ] **Step 5: Manual visual verification**

Run: `yarn dev`, open the app, click **First install** in the sidebar.
Expected, in order:
1. Fresh state: byte hero + "▶ Wake byte up" button; two greyed rows + greyed toolkit chips.
2. Click the button → label "Setting up…", button disabled; after ~0.7s row 1 + toolkit chips light up; after ~1.6s row 2 lights up, byte does a happy hop, "ready" tag + "✓ Toolkit ready" button.
3. Open **Environment** in the sidebar → the recommended skills (PRD writer, Code review) and agent (Test Writer) now show as active; the sidebar Environment badge count dropped.
4. Click a connector's **Connect** (e.g. Notion) on the install view → it flips to "Connected"; Environment shows it connected too.
5. Reload the page → **First install** now shows the "byte is ready" recap with active skills/agents/connectors listed, and the sidebar shows ✓ instead of the dot.
6. Click **Re-run setup** → the animated flow replays without errors.

- [ ] **Step 6: Commit**

```bash
git add components/views/InstallView.tsx components/AppRoot.tsx app/globals.css
git commit -m "feat: first-install view with animated toolkit setup

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** install view + sidebar menu (Task 2/3), animated wake-up (Task 3), real ENV skills/agents install (Task 3 Step 1 `runSetup`), optional connectors (Task 3), `installed` persistence + recap + re-run (Task 1 + Task 3). All spec sections map to a task.
- **Persistence hydration:** `installed` starts `false` and is upgraded in a mount effect, keeping SSR and first client render identical (no hydration mismatch) — matches the spec.
- **Idempotency:** re-running sets `x.s = 1` on already-active items — a no-op, safe.
- **No test runner:** verification is `yarn build` + the manual checklist, consistent with the repo's tooling.
