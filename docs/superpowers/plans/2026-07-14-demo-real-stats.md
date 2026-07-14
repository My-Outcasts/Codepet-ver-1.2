# Demo Real Stats (remote self-report) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remote demo testers see real recap stats (commits + files changed) without installing the toolkit — the demo copy-paste command self-reports a git rollup that the recap reads back.

**Architecture:** New `POST /api/track/demo-recap` (auth = ingest token) writes `liveBuilds/{buildSessionId}.recap`. `demoTerminalCommand` appends a git rollup + `curl` (token + buildSessionId baked in). The store already subscribes `liveBuilds/{buildSessionId}` in remote mode, so `buildLive.recap` reaches the recap. No install; "spent (actions)" stays unavailable remotely.

**Tech Stack:** Next.js route handlers, TypeScript, Vitest.

## Global Constraints

- **Self-report carries only numbers** (`commits`, `filesChanged`) — no `wins` (avoids fragile shell JSON escaping; the recap's `built` already falls back to the plan title).
- Endpoint auth mirrors `/api/track/live`: `token === companyDoc.ingestToken`, else 401.
- Report is **best-effort** (`curl -s … >/dev/null 2>&1`): never breaks the tester's session.
- Only the **remote demo** path changes (non-demo + local-demo recaps unchanged).
- The ingest token is embedded in the copy-paste command (accepted; internal testing).
- Keep the build clean: `npm run typecheck`, `npm run lint` (no new errors), `npm test` green.

## File Structure

- **Modify** `lib/liveBuild.ts` — `DemoRecap` type, `LiveState.recap`, `sanitizeDemoRecap`.
- **Modify** `lib/liveBuild.test.ts` — test `sanitizeDemoRecap`.
- **Create** `app/api/track/demo-recap/route.ts` — the ingest endpoint.
- **Modify** `lib/armSession.ts` + `lib/armSession.test.ts` — `demoTerminalCommand(prompt, report?)` self-report.
- **Modify** `lib/store.tsx` — pass report credentials to `demoTerminalCommand`.
- **Modify** `components/views/BuildCoachView.tsx` — recap reads `buildLive.recap`.

---

### Task 1: `sanitizeDemoRecap` + `LiveState.recap` + the endpoint (TDD for the helper)

**Files:**
- Modify: `lib/liveBuild.ts`, `lib/liveBuild.test.ts`
- Create: `app/api/track/demo-recap/route.ts`

**Interfaces:**
- Produces: `export interface DemoRecap { commits: number; filesChanged: number }`;
  `LiveState.recap?: DemoRecap`; `export function sanitizeDemoRecap(raw): { buildSessionId: string; recap: DemoRecap } | null`.

- [ ] **Step 1: Write the failing test**

Append to `lib/liveBuild.test.ts`:
```ts
import { sanitizeDemoRecap } from './liveBuild';

describe('sanitizeDemoRecap', () => {
  it('parses a valid body', () => {
    expect(sanitizeDemoRecap({ buildSessionId: 'b1', commits: 3, filesChanged: 7 })).toEqual({
      buildSessionId: 'b1',
      recap: { commits: 3, filesChanged: 7 },
    });
  });
  it('rejects a missing buildSessionId', () => {
    expect(sanitizeDemoRecap({ commits: 3, filesChanged: 7 })).toBeNull();
    expect(sanitizeDemoRecap(null)).toBeNull();
  });
  it('coerces/clamps non-numbers and negatives to safe integers', () => {
    expect(sanitizeDemoRecap({ buildSessionId: 'b', commits: '5', filesChanged: -2 })).toEqual({
      buildSessionId: 'b',
      recap: { commits: 5, filesChanged: 0 },
    });
    expect(sanitizeDemoRecap({ buildSessionId: 'b', commits: NaN, filesChanged: 3.9 })).toEqual({
      buildSessionId: 'b',
      recap: { commits: 0, filesChanged: 3 },
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/liveBuild.test.ts`
Expected: FAIL — `sanitizeDemoRecap` not exported.

- [ ] **Step 3: Implement the type + helper**

In `lib/liveBuild.ts`, add `recap?: DemoRecap;` to the `LiveState` interface (after `pendingAsk?`), and add:
```ts
export interface DemoRecap {
  commits: number;
  filesChanged: number;
}

/** Coerce an untrusted demo-recap body into a clamped {buildSessionId, recap}. Returns
 *  null when the buildSessionId is missing. Numbers are floored, non-negative, capped. */
export function sanitizeDemoRecap(
  raw: unknown,
): { buildSessionId: string; recap: DemoRecap } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const buildSessionId =
    typeof r.buildSessionId === 'string' ? r.buildSessionId.trim().slice(0, 128) : '';
  if (!buildSessionId) return null;
  const int = (v: unknown) => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 100000) : 0;
  };
  return { buildSessionId, recap: { commits: int(r.commits), filesChanged: int(r.filesChanged) } };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/liveBuild.test.ts`
Expected: PASS (existing reduceLive/sanitizeLiveEvent tests stay green).

- [ ] **Step 5: Create the endpoint**

Create `app/api/track/demo-recap/route.ts` (mirror `app/api/track/live/route.ts`'s auth):
```ts
// Demo self-report ingest: the demo copy-paste command POSTs a git rollup (commits + files
// changed) so remote testers see real recap stats without installing the toolkit. Auth is the
// per-company ingest token (same as /api/track/live). Writes liveBuilds/{buildSessionId}.recap.
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { paths } from '@/lib/firebase/schema';
import { sanitizeDemoRecap } from '@/lib/liveBuild';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const { companyId, token } = (body ?? {}) as { companyId?: string; token?: string };
  if (!companyId || !token) {
    return NextResponse.json({ error: 'missing companyId or token' }, { status: 400 });
  }
  const db = adminDb();
  const companyRef = db.doc(paths.company(companyId));
  const snap = await companyRef.get();
  const ingestToken = snap.exists ? (snap.data()?.ingestToken as string | undefined) : undefined;
  if (!ingestToken || token !== ingestToken) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const clean = sanitizeDemoRecap(body);
  if (!clean) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  await db.doc(paths.liveBuild(companyId, clean.buildSessionId)).set({ recap: clean.recap }, { merge: true });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: Typecheck + lint + commit**

```bash
npm run typecheck && npx eslint lib/liveBuild.ts lib/liveBuild.test.ts app/api/track/demo-recap/route.ts
git add lib/liveBuild.ts lib/liveBuild.test.ts app/api/track/demo-recap/route.ts
git commit -m "feat(build): demo-recap ingest endpoint + LiveState.recap + sanitizer"
```

---

### Task 2: `demoTerminalCommand` self-report + `armBuild` credentials

**Files:**
- Modify: `lib/armSession.ts`, `lib/armSession.test.ts`, `lib/store.tsx`

**Interfaces:**
- Consumes: `/api/track/demo-recap` (Task 1).
- Produces: `demoTerminalCommand(prompt: string, report?: { apiUrl: string; companyId: string; buildSessionId: string; token: string }): string`.

- [ ] **Step 1: Update the test**

In `lib/armSession.test.ts`, add a case for the report variant (keep the existing no-report test):
```ts
  it('self-reports commits + files when given report credentials', () => {
    const cmd = demoTerminalCommand('build it', {
      apiUrl: 'https://app.example.com',
      companyId: 'c1',
      buildSessionId: 'b1',
      token: 'tok',
    });
    expect(cmd).toContain('git -C ~/codepet-demo rev-list --count HEAD');
    expect(cmd).toContain('git -C ~/codepet-demo ls-files');
    expect(cmd).toContain('https://app.example.com/api/track/demo-recap');
    expect(cmd).toContain('"buildSessionId":"b1"');
    expect(cmd).toContain('"token":"tok"');
  });
  it('omits the self-report when no credentials are given', () => {
    expect(demoTerminalCommand('build it')).not.toContain('/api/track/demo-recap');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/armSession.test.ts`
Expected: FAIL — no report segment yet.

- [ ] **Step 3: Implement**

In `lib/armSession.ts`, change `demoTerminalCommand` to accept an optional `report` and append the rollup+curl when present. Numbers are shell-substituted at run time; ids/token/url are baked at build time:
```ts
export function demoTerminalCommand(
  prompt: string,
  report?: { apiUrl: string; companyId: string; buildSessionId: string; token: string },
): string {
  const b64 = btoa(unescape(encodeURIComponent(DEMO_SEED_HTML)));
  const base =
    `mkdir -p ${DEMO_DIR} && cd ${DEMO_DIR} && ` +
    `{ [ -f index.html ] || echo '${b64}' | base64 -d > index.html; } && ` +
    `claude "${shq(prompt)}"`;
  const selfReport = report
    ? ` ; commits=$(git -C ${DEMO_DIR} rev-list --count HEAD 2>/dev/null || echo 0)` +
      ` ; files=$(git -C ${DEMO_DIR} ls-files 2>/dev/null | wc -l | tr -d ' ')` +
      ` ; curl -s -X POST ${report.apiUrl.replace(/\/$/, '')}/api/track/demo-recap` +
      ` -H 'content-type: application/json'` +
      ` -d "{\\"companyId\\":\\"${report.companyId}\\",\\"token\\":\\"${report.token}\\",` +
      `\\"buildSessionId\\":\\"${report.buildSessionId}\\",` +
      `\\"commits\\":\${commits:-0},\\"filesChanged\\":\${files:-0}}"` +
      ` >/dev/null 2>&1`
    : '';
  // Serve the built page (background) and open it, so the tester can view + re-view it.
  const serve = ` ; python3 -m http.server ${DEMO_PORT} >/dev/null 2>&1 & sleep 1 && open ${DEMO_URL}`;
  return base + selfReport + serve;
}
```
(The `\${commits:-0}` / `\${files:-0}` stay literal in the emitted command so the shell
expands them at run time; `${report.*}` are JS-interpolated at build time.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/armSession.test.ts`
Expected: PASS.

- [ ] **Step 5: Pass credentials from `armBuild`**

In `lib/store.tsx`, the remote-demo branch currently calls
`setBuildLaunchCommand(demoTerminalCommand(buildOpeningPrompt(buildPlan, buildBrief)))`. Change to:
```ts
            setBuildLaunchCommand(
              demoTerminalCommand(buildOpeningPrompt(buildPlan, buildBrief), {
                apiUrl: window.location.origin,
                companyId,
                buildSessionId: id,
                token,
              }),
            );
```
(`companyId`, `id`, and `token` are already in scope in that branch.)

- [ ] **Step 6: Typecheck + lint + commit**

```bash
npm run typecheck && npx eslint lib/armSession.ts lib/armSession.test.ts lib/store.tsx
git add lib/armSession.ts lib/armSession.test.ts lib/store.tsx
git commit -m "feat(build): demo command self-reports commits + files to the recap endpoint"
```

---

### Task 3: Recap shows the self-reported stats

**Files:**
- Modify: `components/views/BuildCoachView.tsx`

**Interfaces:**
- Consumes: `buildLive.recap` (`LiveState.recap` from Task 1); `demoLetsBuild` (already read in this component).

- [ ] **Step 1: Pass recap + demo into `EndStep`**

In the parent (where `<EndStep … actions={actions} … />` is rendered), add two props:
```tsx
            actions={actions}
            recap={buildLive?.recap ?? null}
            demo={demoLetsBuild}
```
And in `EndStep`'s prop type, add:
```ts
  recap: { commits: number; filesChanged: number } | null;
  demo: boolean;
```

- [ ] **Step 2: Feed committed from recap; make spent honest in demo**

In `EndStep`, change `commits` to prefer the live rollup then the self-report:
```ts
  const commits = ev?.commits ?? recap?.commits ?? 0;
```
And the **spent** tile — actions aren't tracked remotely in demo, so show the real files-changed
count when we have a self-report, else "—", instead of a fake `0/{target}`:
```tsx
            <div className="bc-rc">
              <label>spent</label>
              {demo ? (
                <div className="v">{recap ? `${recap.filesChanged} files` : '—'}</div>
              ) : (
                <div className={`v${underBudget ? ' ok' : ' warn'}`}>
                  {actions}/{target} actions
                </div>
              )}
            </div>
```
(Leave `built` and `committed` tiles as-is — `built` already falls back to the plan title, and
`committed` now reads the recap-fed `commits`.)

- [ ] **Step 3: Typecheck + lint + build**

```bash
npm run typecheck && npx eslint components/views/BuildCoachView.tsx && npm run build
```
Expected: clean; build succeeds.

- [ ] **Step 4: Visual check**

`npm run dev` (remote-mode simulation is hard locally, so verify the wiring reads `recap`):
in demo mode, the recap's **committed** reflects `recap.commits` and **spent** shows a files
count (or "—"), with **built** the plan title. Non-demo recap unchanged.

- [ ] **Step 5: Commit**

```bash
git add components/views/BuildCoachView.tsx
git commit -m "feat(build): recap shows self-reported commits + files (spent honest in demo)"
```

---

## Final verification

- [ ] `npm run typecheck && npm run lint && npm test && npm run build` — all pass; new `sanitizeDemoRecap` + `demoTerminalCommand` tests green.
- [ ] Endpoint rejects blank/wrong token (401), clamps inputs; recap reads `buildLive.recap`; non-demo/local-demo recaps unchanged.

## Self-Review Notes

- **Spec coverage:** `LiveState.recap` + sanitizer + endpoint (T1); command self-report + credentials (T2); recap reads recap, honest spent (T3). Covered. Deviation from spec: **dropped `wins`** from the self-report (kept to numbers for shell robustness) — `built` uses the plan-title fallback, so no loss; flagged here.
- **Placeholder scan:** none.
- **Type consistency:** `DemoRecap`/`sanitizeDemoRecap`/`LiveState.recap` (T1) consumed by the endpoint (T1) and the recap (T3); `demoTerminalCommand`'s new `report` param (T2) matches the credentials `armBuild` passes; the endpoint path string matches the command's curl target.
