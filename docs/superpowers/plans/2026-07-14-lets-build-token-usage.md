# Let's Build Token Usage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every user sees a session's token spend ("this build ~X tokens") in the build view — exact locally (transcript read), best-effort remotely (self-report, no install) — plus today's total on a local app (ccusage).

**Architecture:** Local: parse `usage` from the claude stream → `LiveState.tokens`. Remote: the copy-paste command sums the transcript and POSTs `tokens` to `/api/track/demo-recap`, which merges per-key into `liveBuilds/{id}.recap`; the store already subscribes it. Today's total: a ccusage server action (local only). UI in `BuildCoachView`.

**Tech Stack:** TypeScript, Vitest, Next.js, Node child_process. TDD for pure logic; build/lint for UI + the ccusage action.

## Global Constraints

- Token = `input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens` per assistant message (each `Number(x) || 0`).
- Endpoint must **merge per key** (a tokens-only POST must NOT zero a prior `commits`/`filesChanged`).
- Remote self-report is **best-effort** (`… || echo 0`, `curl -s … >/dev/null 2>&1`) — never breaks the session.
- Today's total (ccusage) is **local-only**; returns null on any failure or remotely.
- Non-demo and existing behaviors unchanged except the additive token report/display.
- Keep the build clean: `npm run typecheck`, `npm run lint` (no new errors), `npm test` green.

## File Structure

- **Modify** `lib/liveSession/parseEvents.ts` (+test) — emit a `usage` event.
- **Modify** `lib/liveSession/transcript.ts` (+test) — `TranscriptState.tokens`.
- **Modify** `lib/liveSession/liveFromTranscript.ts` (+test) — pass tokens through.
- **Modify** `lib/liveBuild.ts` (+test) — `LiveState.tokens`; `DemoRecap.tokens`; `sanitizeDemoRecap` partial.
- **Modify** `app/api/track/demo-recap/route.ts` — merge-per-key transaction.
- **Modify** `lib/armSession.ts` (+test) — `tokenReportSuffix`; tokens in `demoTerminalCommand`.
- **Modify** `lib/store.tsx` — append token report to the non-demo remote command.
- **Create** `app/actions/tokens.ts` — `getTodayTokens()`.
- **Modify** `components/views/BuildCoachView.tsx` — the token UI.

---

### Task 1: Local token pipeline (parse → reduce → live) — TDD

**Files:** `lib/liveSession/parseEvents.ts` (+test), `lib/liveSession/transcript.ts` (+test), `lib/liveSession/liveFromTranscript.ts` (+test), `lib/liveBuild.ts`

**Interfaces:** adds `{ kind: 'usage'; tokens: number }` to `SessionEvent`; `TranscriptState.tokens: number`; `LiveState.tokens?: number`.

- [ ] **Step 1: Write failing tests**

`lib/liveSession/parseEvents.test.ts` — add:
```ts
  it('emits a usage event from an assistant message usage block', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 },
      },
    });
    const out = parseEventLine(line);
    expect(out).toContainEqual({ kind: 'assistant-text', text: 'hi' });
    expect(out).toContainEqual({ kind: 'usage', tokens: 18 });
  });
  it('no usage event when the assistant message has no usage', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'x' }] } });
    expect(parseEventLine(line).some((e) => e.kind === 'usage')).toBe(false);
  });
```
`lib/liveSession/transcript.test.ts` — add:
```ts
  it('sums usage events into tokens', () => {
    let s = initialTranscript();
    expect(s.tokens).toBe(0);
    s = reduceTranscript(s, { kind: 'usage', tokens: 18 });
    s = reduceTranscript(s, { kind: 'usage', tokens: 7 });
    expect(s.tokens).toBe(25);
  });
```
`lib/liveSession/liveFromTranscript.test.ts` — add an assertion that `liveFromTranscript(t, …).tokens === t.tokens` for a state with `tokens: 42`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/liveSession/parseEvents.test.ts lib/liveSession/transcript.test.ts lib/liveSession/liveFromTranscript.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`parseEvents.ts`: add `| { kind: 'usage'; tokens: number }` to `SessionEvent`. In the `obj.type === 'assistant'` branch, after the content loop (before `return out`):
```ts
    const u = (obj.message as { usage?: Record<string, unknown> } | undefined)?.usage;
    if (u && typeof u === 'object') {
      const n = (k: string) => Number((u as Record<string, unknown>)[k]) || 0;
      const tokens =
        n('input_tokens') + n('output_tokens') + n('cache_creation_input_tokens') + n('cache_read_input_tokens');
      if (tokens > 0) out.push({ kind: 'usage', tokens });
    }
```
`transcript.ts`: add `tokens: number;` to `TranscriptState`; `tokens: 0` in `initialTranscript()`; in `reduceTranscript`, handle the usage kind:
```ts
    case 'usage':
      return { ...state, tokens: state.tokens + event.tokens };
```
(Place it so it doesn't get swallowed by the permission-resolve logic — a `usage` event carries no permission/tool semantics; return early with the tokens bump.)
`liveFromTranscript.ts`: after building `out`, `out.tokens = t.tokens;` (always).
`lib/liveBuild.ts`: add `tokens?: number;` to `LiveState` (after `pendingAsk?`).

- [ ] **Step 4: Run to verify pass**

Run the three test files again → PASS. Also `npx vitest run lib/liveBuild.test.ts` (unaffected) green.

- [ ] **Step 5: Typecheck + lint + commit**

```bash
npm run typecheck && npx eslint lib/liveSession/parseEvents.ts lib/liveSession/transcript.ts lib/liveSession/liveFromTranscript.ts lib/liveBuild.ts
git add lib/liveSession/parseEvents.ts lib/liveSession/parseEvents.test.ts lib/liveSession/transcript.ts lib/liveSession/transcript.test.ts lib/liveSession/liveFromTranscript.ts lib/liveSession/liveFromTranscript.test.ts lib/liveBuild.ts
git commit -m "feat(build): parse claude token usage into LiveState.tokens (local, exact)"
```

---

### Task 2: `DemoRecap.tokens` + partial sanitizer + merge-per-key endpoint — TDD

**Files:** `lib/liveBuild.ts` (+test), `app/api/track/demo-recap/route.ts`

**Interfaces:** `DemoRecap = { commits: number; filesChanged: number; tokens: number }`; `sanitizeDemoRecap(raw): { buildSessionId: string; recap: Partial<DemoRecap> } | null` (only the numeric keys present in the body).

- [ ] **Step 1: Update the tests**

In `lib/liveBuild.test.ts`, adjust the `sanitizeDemoRecap` tests for the partial shape + add a tokens case:
```ts
  it('keeps only the numeric keys present (partial)', () => {
    expect(sanitizeDemoRecap({ buildSessionId: 'b', tokens: 1200 })).toEqual({
      buildSessionId: 'b',
      recap: { tokens: 1200 },
    });
    expect(sanitizeDemoRecap({ buildSessionId: 'b', commits: 3, filesChanged: 7 })).toEqual({
      buildSessionId: 'b',
      recap: { commits: 3, filesChanged: 7 },
    });
  });
  it('rejects a missing buildSessionId', () => {
    expect(sanitizeDemoRecap({ tokens: 1 })).toBeNull();
    expect(sanitizeDemoRecap(null)).toBeNull();
  });
  it('clamps present numbers', () => {
    expect(sanitizeDemoRecap({ buildSessionId: 'b', commits: '5', filesChanged: -2, tokens: 3.9 })).toEqual(
      { buildSessionId: 'b', recap: { commits: 5, filesChanged: 0, tokens: 3 } },
    );
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/liveBuild.test.ts` → FAIL (old sanitizer returns all three always / has no tokens).

- [ ] **Step 3: Implement the partial sanitizer + type**

In `lib/liveBuild.ts`, change `DemoRecap` to include `tokens: number` and rewrite `sanitizeDemoRecap`:
```ts
export interface DemoRecap {
  commits: number;
  filesChanged: number;
  tokens: number;
}

export function sanitizeDemoRecap(
  raw: unknown,
): { buildSessionId: string; recap: Partial<DemoRecap> } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const buildSessionId =
    typeof r.buildSessionId === 'string' ? r.buildSessionId.trim().slice(0, 128) : '';
  if (!buildSessionId) return null;
  const int = (v: unknown, cap: number) => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), cap) : 0;
  };
  const recap: Partial<DemoRecap> = {};
  if (r.commits != null) recap.commits = int(r.commits, 100000);
  if (r.filesChanged != null) recap.filesChanged = int(r.filesChanged, 100000);
  if (r.tokens != null) recap.tokens = int(r.tokens, 2_000_000_000);
  return { buildSessionId, recap };
}
```
(`LiveState.recap?` was `DemoRecap`; keep it `DemoRecap` — all three are always present on read, since consumers read individual fields with `?.`.)

- [ ] **Step 4: Merge-per-key in the endpoint**

In `app/api/track/demo-recap/route.ts`, replace the plain `.set({ recap }, { merge: true })` with a transaction that preserves prior recap fields:
```ts
  const ref = db.doc(paths.liveBuild(companyId, clean.buildSessionId));
  await db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    const prev = (cur.exists ? (cur.data()?.recap as Partial<typeof clean.recap>) : null) ?? {};
    tx.set(ref, { recap: { ...prev, ...clean.recap } }, { merge: true });
  });
```

- [ ] **Step 5: Run to verify pass + typecheck**

Run: `npx vitest run lib/liveBuild.test.ts` → PASS. `npm run typecheck` clean. Confirm `app/api/track/demo-recap` still typechecks with the partial recap.

- [ ] **Step 6: Commit**

```bash
git add lib/liveBuild.ts lib/liveBuild.test.ts app/api/track/demo-recap/route.ts
git commit -m "feat(build): recap accepts tokens; endpoint merges recap per key"
```

---

### Task 3: Remote self-report of tokens — TDD

**Files:** `lib/armSession.ts` (+test), `lib/store.tsx`

**Interfaces:** `tokenReportSuffix(report: { apiUrl: string; companyId: string; buildSessionId: string; token: string }): string`; `demoTerminalCommand` includes it.

- [ ] **Step 1: Update the test**

In `lib/armSession.test.ts`, add:
```ts
  it('demoTerminalCommand includes a token self-report when given credentials', () => {
    const cmd = demoTerminalCommand('build it', {
      apiUrl: 'https://app.example.com',
      companyId: 'c1',
      buildSessionId: 'b1',
      token: 'tok',
    });
    expect(cmd).toContain('~/.claude/projects');
    expect(cmd).toContain('python3 -c');
    expect(cmd).toContain('https://app.example.com/api/track/demo-recap');
    expect(cmd).toContain('"tokens":');
  });
```
(Keep the existing commits/files + no-report assertions.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/armSession.test.ts` → FAIL.

- [ ] **Step 3: Implement `tokenReportSuffix` + use it**

In `lib/armSession.ts`, add (reusing `DEMO_DIR` isn't needed — the transcript path is global):
```ts
// Best-effort: sum this session's tokens from the newest claude transcript and POST them, so
// remote testers see real token usage with no toolkit install. Single-line python (no try/except):
// a malformed line makes it error out and `|| echo 0` yields 0.
export function tokenReportSuffix(report: {
  apiUrl: string;
  companyId: string;
  buildSessionId: string;
  token: string;
}): string {
  const url = `${report.apiUrl.replace(/\/$/, '')}/api/track/demo-recap`;
  const py =
    'import json,sys;print(sum(' +
    "(lambda u:u.get('input_tokens',0)+u.get('output_tokens',0)+u.get('cache_creation_input_tokens',0)+u.get('cache_read_input_tokens',0))" +
    "((json.loads(l).get('message') or {}).get('usage') or {}) for l in open(sys.argv[1])))";
  return (
    ` ; TF=$(find ~/.claude/projects -name '*.jsonl' -newermt '-30 minutes' 2>/dev/null | xargs ls -t 2>/dev/null | head -1)` +
    ` ; tokens=$(python3 -c "${py}" "$TF" 2>/dev/null || echo 0)` +
    ` ; curl -s -X POST ${url} -H 'content-type: application/json'` +
    ` -d '{"companyId":"${report.companyId}","token":"${report.token}","buildSessionId":"${report.buildSessionId}","tokens":'"\${tokens:-0}"'}'` +
    ` >/dev/null 2>&1`
  );
}
```
Then in `demoTerminalCommand`, when `report` is present, append `tokenReportSuffix(report)` (after the existing commits/files self-report, before or after the serve+open — either; keep all segments `;`-joined so all run).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/armSession.test.ts` → PASS. **Also verify empirically**: reproduce the emitted `tokenReportSuffix` with concrete values, `bash -n` it, and run it (with `curl` shadowed) against a scratch `.jsonl` containing a couple of assistant lines with `usage` — confirm `tokens` sums correctly and the JSON payload is valid.

- [ ] **Step 5: Non-demo remote also reports**

In `lib/store.tsx`, the non-demo remote branch sets
`const command = terminalCommand(dir, buildOpeningPrompt(buildPlan, buildBrief));`. After it, append the token report:
```ts
            const command =
              terminalCommand(dir, buildOpeningPrompt(buildPlan, buildBrief)) +
              tokenReportSuffix({ apiUrl: window.location.origin, companyId, buildSessionId: id, token });
```
(Import `tokenReportSuffix` from `./armSession`. `companyId`, `id`, and `token` are in scope; the token is already fetched via `ensureIngestToken` a few lines above in that branch — confirm and reuse it.)

- [ ] **Step 6: Typecheck + lint + commit**

```bash
npm run typecheck && npx eslint lib/armSession.ts lib/armSession.test.ts lib/store.tsx
git add lib/armSession.ts lib/armSession.test.ts lib/store.tsx
git commit -m "feat(build): remote builds self-report token usage (demo + real)"
```

---

### Task 4: `getTodayTokens` ccusage server action

**Files:** Create `app/actions/tokens.ts`

**Interfaces:** `export async function getTodayTokens(): Promise<number | null>`.

- [ ] **Step 1: Implement**

Create `app/actions/tokens.ts`:
```ts
'use server';
// Today's total Claude Code tokens for a LOCAL app, via ccusage. Best-effort: returns null
// on any error or when ccusage isn't available (e.g. hosted/remote). Never throws.
import { spawn } from 'node:child_process';

function ymd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

export async function getTodayTokens(): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const since = ymd(new Date());
      const child = spawn('npx', ['-y', 'ccusage@latest', 'daily', '--since', since, '--json'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let out = '';
      const timer = setTimeout(() => {
        child.kill();
        resolve(null);
      }, 20000);
      child.stdout.on('data', (b) => (out += b.toString()));
      child.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
      child.on('close', () => {
        clearTimeout(timer);
        try {
          const total = JSON.parse(out)?.totals?.totalTokens;
          resolve(typeof total === 'number' ? total : null);
        } catch {
          resolve(null);
        }
      });
    } catch {
      resolve(null);
    }
  });
}
```

- [ ] **Step 2: Typecheck + lint + commit**

```bash
npm run typecheck && npx eslint app/actions/tokens.ts
git add app/actions/tokens.ts
git commit -m "feat(build): getTodayTokens server action (ccusage, local, best-effort)"
```

---

### Task 5: Token UI in the build view

**Files:** `components/views/BuildCoachView.tsx`

**Interfaces:** consumes `buildLive.tokens` (Task 1), `buildLive.recap?.tokens` (Tasks 2–3), `getTodayTokens` (Task 4).

- [ ] **Step 1: A compact formatter + today's total**

At the top of `BuildCoachView.tsx`, add:
```ts
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}
```
In the main component, fetch today's total (once + refresh while building):
```ts
  const [today, setToday] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => getTodayTokens().then((n) => alive && setToday(n));
    load();
    const id = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
```
(Import `getTodayTokens` from `@/app/actions/tokens`.)

- [ ] **Step 2: Show it in DURING + END**

`DuringStep` — pass `tokens={live?.tokens ?? null}` and `today={today}` in, and under the meter render a small line when data exists:
```tsx
      {(tokens || today != null) && (
        <div className="bc-tokens" style={{ fontSize: 12, color: 'var(--t-4)', marginTop: 6 }}>
          🔢 {tokens ? <>This build <b>~{fmtTokens(tokens)}</b></> : null}
          {tokens && today != null ? ' · ' : null}
          {today != null ? <>Today <b>~{fmtTokens(today)}</b></> : null} tokens
        </div>
      )}
```
`EndStep` — pass `buildTokens={buildLive?.recap?.tokens ?? actions === 0 ? null : null}`… simpler: pass `buildTokens={buildLive?.tokens ?? buildLive?.recap?.tokens ?? null}` and `today={today}` from the parent (the parent has `buildLive`), and render the same `bc-tokens` line in the recap. (Add `buildTokens: number | null; today: number | null;` to `EndStep`'s props; `DuringStep` gets `tokens: number | null; today: number | null;`.)

- [ ] **Step 3: Typecheck + lint + build**

```bash
npm run typecheck && npx eslint components/views/BuildCoachView.tsx && npm run build
```
Expected: clean; build succeeds.

- [ ] **Step 4: Visual check**

`npm run dev`: run a local Let's build — the DURING meter shows "This build ~X · Today ~Y tokens" (X ticks up live, Y from ccusage after ~a few seconds); the recap shows the build's tokens. Remote demo/real recap shows the self-reported "this build" tokens (Today absent).

- [ ] **Step 5: Commit**

```bash
git add components/views/BuildCoachView.tsx
git commit -m "feat(build): show per-build + today's token usage in the build view"
```

---

## Final verification

- [ ] `npm run typecheck && npm run lint && npm test && npm run build` — all pass; parseEvents / transcript / liveFromTranscript / sanitizeDemoRecap / demoTerminalCommand tests green.
- [ ] Local build: tokens tick live + in recap; today shows. Remote build: recap shows self-reported tokens; today absent. Endpoint tokens-only POST doesn't zero commits/files.

## Self-Review Notes

- **Spec coverage:** local pipeline (T1); endpoint tokens + merge (T2); remote self-report demo+real (T3); ccusage (T4); UI (T5). Covered.
- **Placeholder scan:** none (T5 EndStep prop wording collapsed to a concrete `buildTokens` expression).
- **Type consistency:** `usage` event (T1) consumed by reduceTranscript (T1); `DemoRecap.tokens` + partial sanitizer (T2) consumed by the endpoint (T2) and the command (T3); `tokenReportSuffix` shape (T3) matches store credentials; UI reads `buildLive.tokens`/`recap.tokens`/`getTodayTokens` (T5).
