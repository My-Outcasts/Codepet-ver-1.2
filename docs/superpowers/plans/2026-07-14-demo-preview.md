# Demo Preview (view / re-view the built page) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the demo build writes `~/codepet-demo/index.html`, serve it on `localhost:4321` and give a real clickable **Open demo →** link in the build view so the tester can view it and re-open it after closing the tab.

**Architecture:** The demo copy-paste command ends by launching `python3 -m http.server 4321` (background) and opening the browser; the build view renders a static `<a href="http://localhost:4321">` (localhost resolves on the tester's own machine, so it works even for remote/Vercel testers). No backend/state change.

**Tech Stack:** TypeScript, Vitest, React. TDD for the command; build+lint for the UI.

## Global Constraints

- Port is exactly **4321**; URL `http://localhost:4321`.
- The server line uses `;` before it (serve even if claude exits non-zero) and `&` to background it.
- macOS-first (`open`), consistent with the existing flow.
- Only affects demo mode (`demoLetsBuild`) / `demoTerminalCommand`; nothing else changes.
- Keep the build clean: `npm run typecheck` clean, `npm run lint` no new errors, `npm test` green (updated `demoTerminalCommand` test).

## File Structure

- **Modify** `lib/armSession.ts` — `DEMO_PORT`, `DEMO_URL`; append serve+open to `demoTerminalCommand`.
- **Modify** `lib/armSession.test.ts` — assert the serve+open in the command.
- **Modify** `components/views/BuildCoachView.tsx` — an **Open demo →** link in the demo banner.

---

### Task 1: Serve + auto-open in `demoTerminalCommand` (TDD)

**Files:**
- Modify: `lib/armSession.ts`
- Test: `lib/armSession.test.ts`

**Interfaces:**
- Produces: `export const DEMO_PORT = 4321`, `export const DEMO_URL = 'http://localhost:4321'`; `demoTerminalCommand` now ends by serving the demo dir on `DEMO_PORT` and opening `DEMO_URL`.

- [ ] **Step 1: Update the test**

In `lib/armSession.test.ts`, extend the existing `demoTerminalCommand` test's assertions:
```ts
  it('creates the demo dir, seeds index.html only if missing, then runs claude and serves it', () => {
    const cmd = demoTerminalCommand('build a landing page');
    expect(cmd).toContain('mkdir -p ~/codepet-demo');
    expect(cmd).toContain('cd ~/codepet-demo');
    expect(cmd).toContain('[ -f index.html ]');
    expect(cmd).toContain('base64 -d > index.html');
    expect(cmd).toContain('claude "build a landing page"');
    expect(cmd).toContain('python3 -m http.server 4321');
    expect(cmd).toContain('open http://localhost:4321');
  });
```
(Keep the existing `DEMO_DIR` assertion test.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/armSession.test.ts`
Expected: FAIL — the command doesn't yet contain the server/open parts.

- [ ] **Step 3: Implement**

In `lib/armSession.ts`, add the constants beside `DEMO_DIR`:
```ts
export const DEMO_PORT = 4321;
export const DEMO_URL = 'http://localhost:4321';
```
and append serve+open to `demoTerminalCommand`'s returned string:
```ts
export function demoTerminalCommand(prompt: string): string {
  const b64 = btoa(unescape(encodeURIComponent(DEMO_SEED_HTML)));
  return (
    `mkdir -p ${DEMO_DIR} && cd ${DEMO_DIR} && ` +
    `{ [ -f index.html ] || echo '${b64}' | base64 -d > index.html; } && ` +
    `claude "${shq(prompt)}" ; ` +
    // Serve the built page (background) and open it, so the tester can view + re-view it.
    `python3 -m http.server ${DEMO_PORT} >/dev/null 2>&1 & sleep 1 && open ${DEMO_URL}`
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/armSession.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint + commit**

```bash
npm run typecheck && npx eslint lib/armSession.ts lib/armSession.test.ts
git add lib/armSession.ts lib/armSession.test.ts
git commit -m "feat(build): demo command serves ~/codepet-demo on localhost:4321 and opens it"
```

---

### Task 2: "Open demo →" link in the build view

**Files:**
- Modify: `components/views/BuildCoachView.tsx`

**Interfaces:**
- Consumes: `DEMO_URL` from `@/lib/armSession` (Task 1); `demoLetsBuild` (already read in this component).

- [ ] **Step 1: Import `DEMO_URL`**

Add to the imports in `BuildCoachView.tsx`:
```ts
import { DEMO_URL } from '@/lib/armSession';
```

- [ ] **Step 2: Add the link to the demo banner**

Replace the existing demo banner block (the `{demoLetsBuild && (<div …>Demo mode — …</div>)}`) with a version that lays the text and the link in a row:
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
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
              justifyContent: 'space-between',
            }}
          >
            <span>
              Demo mode — building a throwaway landing page in <code>~/codepet-demo</code>.
            </span>
            <a
              href={DEMO_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontWeight: 700, color: '#7DE3FF', textDecoration: 'none', whiteSpace: 'nowrap' }}
            >
              Open demo →
            </a>
          </div>
        )}
```

- [ ] **Step 3: Typecheck + lint + build**

```bash
npm run typecheck && npx eslint components/views/BuildCoachView.tsx && npm run build
```
Expected: clean; build succeeds.

- [ ] **Step 4: Visual check**

`npm run dev`, run a demo "Let's build". In the build view (during + recap) the banner shows an **Open demo →** link to `http://localhost:4321`; after a build the remote command self-serves + opens the page; clicking the link re-opens it in a new tab.

- [ ] **Step 5: Commit**

```bash
git add components/views/BuildCoachView.tsx
git commit -m "feat(build): Open demo link (localhost:4321) in the build view"
```

---

## Final verification

- [ ] `npm run typecheck && npm run lint && npm test && npm run build` — all pass; `demoTerminalCommand` test green.
- [ ] Demo command ends with `python3 -m http.server 4321 … & … open http://localhost:4321`; build view shows a working **Open demo →** link in demo mode.

## Self-Review Notes

- **Spec coverage:** serve+open in the command + `DEMO_PORT`/`DEMO_URL` (T1); Open-demo link in the build view, both steps via the shared banner (T2). Covered.
- **Placeholder scan:** none.
- **Type consistency:** `DEMO_URL` defined in T1, imported in T2; port 4321 consistent between the command and the URL constant.
