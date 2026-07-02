# Build Coach Live Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the mocked "Cùng làm" (Build Coach) DURING/END steps into a real loop that brackets one live Claude Code session — plan → auto-launch `claude` → watch real activity live → reflect on real results.

**Architecture:** START writes an arm-file (`~/.claude/codepet/current-build.json`) and opens a Terminal running `claude` with the plan preloaded. New Claude Code hooks (`SessionStart`/`PostToolUse`/`Stop`) POST incremental activity to `/api/track/live`, which folds them into a `liveBuilds/{buildSessionId}` Firestore doc via `reduceLive`. DURING subscribes with `onSnapshot` and drives the existing `budgetState()` meter from real action counts. The existing `SessionEnd` tracker still produces the authoritative rollup; END reads it.

**Tech Stack:** Next.js (server actions + route handlers, `runtime = 'nodejs'`), Firebase (client SDK reads, Admin SDK writes), Vitest, Node hook scripts (`.mjs`), macOS `osascript`.

## Global Constraints

- **Budget unit = actions (tool-uses), not tokens.** `pct = min(100, round(actionCount / plan.budgetActions * 100))`.
- **Danger threshold reused verbatim:** `DANGER_PCT = 80` from `lib/buildCoach.ts`; `budgetState()` is used as-is, unchanged.
- **Passive/observe only.** No `UserPromptSubmit`/`PreToolUse` injection or gating.
- **Local mode only** for the live loop (`detectCapability().mode === 'local'`). Remote/web → fallback command + END-from-SessionEnd, clearly labelled.
- **macOS-first** Terminal automation (`osascript`). Other platforms show the copy-paste command.
- **Hooks must never block Claude Code:** the emitter POSTs with a short `AbortSignal.timeout` and swallows all errors, exiting 0 — mirror `toolkit/hooks/codepet-track.mjs`.
- **Admin SDK rejects `undefined` field values** — drop undefined keys before writing (reuse the `dropUndefined` pattern from `app/api/track/route.ts`).
- **Ingest auth** reuses the per-company `ingestToken` on the company doc, checked exactly like `/api/track`.
- **UI copy language:** match the existing `BuildCoachView.tsx`, which is in **English** (not the Vietnamese demo). Keep new copy English + warm Byte voice.

---

### Task 1: Add `budgetActions` to the plan model

**Files:**
- Modify: `lib/ai/plan.ts`
- Test: `lib/ai/plan.test.ts`

**Interfaces:**
- Produces: `BytePlan.budgetActions: number`; `PLAN_SCHEMA` requires `budgetActions`; `buildPlanPrompt` asks for it.

- [ ] **Step 1: Write failing tests** — append to `lib/ai/plan.test.ts`:

```ts
describe('budgetActions in plan model', () => {
  it('prompt asks for an action budget', () => {
    const p = buildPlanPrompt({ audience: 'a', doneLooks: 'b' });
    expect(p.toLowerCase()).toMatch(/budgetactions|number of .*(steps|actions)|actions/);
  });
});

// Add to the imports at top of the file:
//   import { PLAN_SCHEMA } from './plan';
describe('PLAN_SCHEMA', () => {
  it('requires budgetActions as an integer', () => {
    expect((PLAN_SCHEMA.required as string[])).toContain('budgetActions');
    const props = PLAN_SCHEMA.properties as Record<string, { type?: string }>;
    expect(props.budgetActions?.type).toBe('integer');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run lib/ai/plan.test.ts`
Expected: FAIL (`PLAN_SCHEMA` has no `budgetActions`; prompt lacks the phrasing).

- [ ] **Step 3: Implement** — in `lib/ai/plan.ts`:

Add to `BytePlan`:
```ts
  /** Expected number of agent actions (tool-uses) the plan should take —
   *  the DURING "piggy bank" fills toward this. */
  budgetActions: number;
```
In `buildPlanPrompt`, replace the budget sentence with:
```ts
    'Return a plan with 3-5 concrete, ordered steps (each a short imperative line),',
    'a suggested token budget in thousands (budgetK, between 100 and 800), an',
    'expected number of agent actions/tool-uses (budgetActions, an integer between 5',
    "and 40), and a short encouraging title in Byte's warm voice. The last step",
    'should always be to double-check the work before calling it done.',
```
In `PLAN_SCHEMA.properties` add and mark required:
```ts
    budgetActions: {
      type: 'integer',
      description: 'Expected number of agent actions/tool-uses (5-40).',
    },
```
```ts
  required: ['title', 'budgetK', 'budgetActions', 'steps'],
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run lib/ai/plan.test.ts`
Expected: PASS (all, including the existing prompt/sanitize tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/plan.ts lib/ai/plan.test.ts
git commit -m "feat(build-coach): add budgetActions to the Byte plan model"
```

---

### Task 2: `reduceLive` — pure live-activity reducer

**Files:**
- Create: `lib/liveBuild.ts`
- Test: `lib/liveBuild.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type Millis = number;
  interface LiveEvent { buildSessionId: string; sessionId: string; kind: 'start' | 'tool' | 'turn'; tool?: string; ts: Millis; }
  interface LiveState { actionCount: number; turns: number; recentTools: string[]; startedAt: Millis; lastTs: Millis; ended: boolean; }
  function initialLive(ts: Millis): LiveState;
  function reduceLive(state: LiveState | null, event: LiveEvent): LiveState;
  function eventKindFor(hookEventName: string): LiveEvent['kind'] | null;
  const RECENT_TOOLS_CAP = 8;
  ```

- [ ] **Step 1: Write failing tests** — `lib/liveBuild.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { reduceLive, initialLive, eventKindFor, RECENT_TOOLS_CAP } from './liveBuild';

const base = { buildSessionId: 'b1', sessionId: 's1' };

describe('reduceLive', () => {
  it('start resets state', () => {
    const prev = { actionCount: 9, turns: 3, recentTools: ['Edit'], startedAt: 1, lastTs: 5, ended: true };
    const s = reduceLive(prev, { ...base, kind: 'start', ts: 100 });
    expect(s).toEqual({ actionCount: 0, turns: 0, recentTools: [], startedAt: 100, lastTs: 100, ended: false });
  });

  it('start from null initialises', () => {
    const s = reduceLive(null, { ...base, kind: 'start', ts: 50 });
    expect(s.actionCount).toBe(0);
    expect(s.startedAt).toBe(50);
  });

  it('tool increments actionCount and records the tool', () => {
    const s0 = initialLive(10);
    const s1 = reduceLive(s0, { ...base, kind: 'tool', tool: 'Edit', ts: 20 });
    expect(s1.actionCount).toBe(1);
    expect(s1.recentTools).toEqual(['Edit']);
    expect(s1.lastTs).toBe(20);
  });

  it('caps recentTools to the last RECENT_TOOLS_CAP', () => {
    let s = initialLive(0);
    for (let i = 0; i < RECENT_TOOLS_CAP + 3; i++) s = reduceLive(s, { ...base, kind: 'tool', tool: `T${i}`, ts: i });
    expect(s.recentTools).toHaveLength(RECENT_TOOLS_CAP);
    expect(s.recentTools[RECENT_TOOLS_CAP - 1]).toBe(`T${RECENT_TOOLS_CAP + 2}`);
    expect(s.actionCount).toBe(RECENT_TOOLS_CAP + 3);
  });

  it('turn increments turns only', () => {
    const s = reduceLive(initialLive(0), { ...base, kind: 'turn', ts: 7 });
    expect(s.turns).toBe(1);
    expect(s.actionCount).toBe(0);
    expect(s.lastTs).toBe(7);
  });

  it('tool event with no tool name still counts the action', () => {
    const s = reduceLive(initialLive(0), { ...base, kind: 'tool', ts: 3 });
    expect(s.actionCount).toBe(1);
    expect(s.recentTools).toEqual([]);
  });
});

describe('eventKindFor', () => {
  it('maps hook event names to live kinds', () => {
    expect(eventKindFor('SessionStart')).toBe('start');
    expect(eventKindFor('PostToolUse')).toBe('tool');
    expect(eventKindFor('Stop')).toBe('turn');
    expect(eventKindFor('SessionEnd')).toBeNull();
    expect(eventKindFor('whatever')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `yarn vitest run lib/liveBuild.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `lib/liveBuild.ts`:

```ts
// Pure, framework-free reducer for a live build session's activity counters.
// The /api/track/live endpoint folds each incoming LiveEvent into the stored
// LiveState with reduceLive; the local hook emitter maps a Claude Code hook
// event name to a LiveEvent kind with eventKindFor. No I/O here — unit-tested.
// See docs/superpowers/specs/2026-07-02-build-coach-live-session-design.md.
import type { Millis } from './firebase/schema';

export const RECENT_TOOLS_CAP = 8;

export interface LiveEvent {
  buildSessionId: string;
  sessionId: string;
  kind: 'start' | 'tool' | 'turn';
  tool?: string;
  ts: Millis;
}

export interface LiveState {
  actionCount: number;
  turns: number;
  recentTools: string[];
  startedAt: Millis;
  lastTs: Millis;
  ended: boolean;
}

export function initialLive(ts: Millis): LiveState {
  return { actionCount: 0, turns: 0, recentTools: [], startedAt: ts, lastTs: ts, ended: false };
}

export function reduceLive(state: LiveState | null, event: LiveEvent): LiveState {
  if (event.kind === 'start') return initialLive(event.ts);
  const s = state ?? initialLive(event.ts);
  if (event.kind === 'tool') {
    const recentTools = event.tool
      ? [...s.recentTools, event.tool].slice(-RECENT_TOOLS_CAP)
      : s.recentTools;
    return { ...s, actionCount: s.actionCount + 1, recentTools, lastTs: event.ts };
  }
  // kind === 'turn'
  return { ...s, turns: s.turns + 1, lastTs: event.ts };
}

export function eventKindFor(hookEventName: string): LiveEvent['kind'] | null {
  switch (hookEventName) {
    case 'SessionStart':
      return 'start';
    case 'PostToolUse':
      return 'tool';
    case 'Stop':
      return 'turn';
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run lib/liveBuild.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/liveBuild.ts lib/liveBuild.test.ts
git commit -m "feat(build-coach): reduceLive activity reducer + hook-kind mapping"
```

---

### Task 3: arm-session pure helpers

**Files:**
- Create: `lib/armSession.ts`
- Test: `lib/armSession.test.ts`

**Interfaces:**
- Consumes: `BytePlan` from `lib/ai/plan`.
- Produces: `buildOpeningPrompt(plan, audience, doneLooks): string`; `terminalCommand(projectDir, prompt): string` (a `cd … && claude "…"` string, double-quote-escaped for a shell).

- [ ] **Step 1: Write failing tests** — `lib/armSession.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildOpeningPrompt, terminalCommand } from './armSession';
import type { BytePlan } from './ai/plan';

const plan: BytePlan = {
  title: "Byte's got it!",
  budgetK: 300,
  budgetActions: 12,
  steps: ['Scaffold the form', 'Wire validation', 'Double-check it works'],
};

describe('buildOpeningPrompt', () => {
  it('includes audience, done criteria, and every plan step', () => {
    const p = buildOpeningPrompt(plan, 'returning users', 'email login works');
    expect(p).toContain('returning users');
    expect(p).toContain('email login works');
    for (const s of plan.steps) expect(p).toContain(s);
  });
});

describe('terminalCommand', () => {
  it('cds into the project and launches claude with the prompt', () => {
    const cmd = terminalCommand('/Users/me/proj', 'hello');
    expect(cmd).toBe('cd "/Users/me/proj" && claude "hello"');
  });

  it('escapes double quotes and backslashes in the prompt and dir', () => {
    const cmd = terminalCommand('/tmp/a"b', 'say "hi"\\done');
    expect(cmd).toBe('cd "/tmp/a\\"b" && claude "say \\"hi\\"\\\\done"');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `yarn vitest run lib/armSession.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `lib/armSession.ts`:

```ts
// Pure helpers for arming a live build session: compose the opening prompt Byte
// hands to `claude`, and build the shell command a Terminal window runs. No I/O
// so both are unit-tested; the osascript/fs spawn lives in the server action.
// See docs/superpowers/specs/2026-07-02-build-coach-live-session-design.md.
import type { BytePlan } from './ai/plan';

/** The first message the launched `claude` session receives, so it starts on-scope. */
export function buildOpeningPrompt(plan: BytePlan, audience: string, doneLooks: string): string {
  return [
    `Let's build: ${plan.title}`,
    `Who it's for: ${audience}`,
    `What "done" looks like: ${doneLooks}`,
    '',
    'Plan:',
    ...plan.steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    'Keep it small and token-thrifty; double-check before calling it done.',
  ].join('\n');
}

/** Escape a string for embedding inside a double-quoted shell argument. */
function shq(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** `cd "<dir>" && claude "<prompt>"` — the command a new Terminal window runs. */
export function terminalCommand(projectDir: string, prompt: string): string {
  return `cd "${shq(projectDir)}" && claude "${shq(prompt)}"`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run lib/armSession.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/armSession.ts lib/armSession.test.ts
git commit -m "feat(build-coach): opening-prompt + terminal-command helpers"
```

---

### Task 4: live emitter hook script

**Files:**
- Create: `toolkit/hooks/codepet-live.mjs`
- (No unit test — same untested-shell posture as `codepet-track.mjs`; its pure logic `eventKindFor` is already tested in Task 2. Verified by the manual e2e pass.)

**Interfaces:**
- Consumes: `~/.claude/codepet/current-build.json` (written by Task 7), `~/.claude/codepet/track.json` (existing, for `companyId`/`token`/`apiUrl`), hook JSON on stdin.
- Produces: `POST {apiUrl}/api/track/live { companyId, token, event: LiveEvent }`.

- [ ] **Step 1: Implement** — `toolkit/hooks/codepet-live.mjs`:

```js
#!/usr/bin/env node
// Codepet live-activity hook. Claude Code runs this on SessionStart / PostToolUse /
// Stop. It reads the hook JSON on stdin, maps the event to a live "kind", and POSTs
// an incremental LiveEvent to Codepet's /api/track/live so the Build Coach DURING
// meter updates in real time. It NEVER blocks or fails the session: every step is
// guarded, the POST has a short timeout, and the process always exits 0.
//
// Only emits while a build is armed: reads <claudeDir>/codepet/current-build.json for
// the active buildSessionId (written by the arm-session server action). If absent, no-op.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function kindFor(name) {
  if (name === 'SessionStart') return 'start';
  if (name === 'PostToolUse') return 'tool';
  if (name === 'Stop') return 'turn';
  return null;
}

async function main() {
  let input = {};
  try {
    input = JSON.parse(readStdin() || '{}');
  } catch {
    return;
  }
  const kind = kindFor(input.hook_event_name);
  if (!kind) return;

  const claudeDir = process.env.CODEPET_CLAUDE_DIR || path.join(os.homedir(), '.claude');
  let build;
  let cfg;
  try {
    build = JSON.parse(fs.readFileSync(path.join(claudeDir, 'codepet', 'current-build.json'), 'utf8'));
    cfg = JSON.parse(fs.readFileSync(path.join(claudeDir, 'codepet', 'track.json'), 'utf8'));
  } catch {
    return; // no active build or no config — nothing to do
  }
  if (!build?.buildSessionId) return;
  if (!cfg?.companyId || !cfg?.token || !cfg?.apiUrl) return;
  if (cfg.enabled === false) return;

  const event = {
    buildSessionId: build.buildSessionId,
    sessionId: input.session_id || `sess-${Date.now()}`,
    kind,
    tool: kind === 'tool' ? input.tool_name : undefined,
    ts: Date.now(),
  };

  try {
    await fetch(`${cfg.apiUrl.replace(/\/$/, '')}/api/track/live`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ companyId: cfg.companyId, token: cfg.token, event }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // best-effort — a failed POST must never disrupt Claude Code
  }
}

main().finally(() => process.exit(0));
```

- [ ] **Step 2: Verify it parses**

Run: `node --check toolkit/hooks/codepet-live.mjs`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add toolkit/hooks/codepet-live.mjs
git commit -m "feat(build-coach): live-activity hook emitter script"
```

---

### Task 5: install the live hooks alongside the tracker

**Files:**
- Modify: `lib/installer/tracking.mjs`
- Test: `lib/installer/tracking.test.mjs` (extend), `lib/installer/settings.test.mjs` (already covers mergeHook — no change)

**Interfaces:**
- Consumes: `mergeHook(settings, eventName, entry)` (existing).
- Produces: after `installTracking`, `settings.json` also contains `SessionStart`, `PostToolUse`, `Stop` hooks pointing at the copied `codepet-live.mjs`, and `<claudeDir>/codepet/codepet-live.mjs` exists.

- [ ] **Step 1: Write failing test** — add to `lib/installer/tracking.test.mjs`:

```js
it('installs the live emitter script and its three hooks', () => {
  const dir = mkTmpClaudeDir(); // reuse the helper the file already uses
  installTracking(dir, { companyId: 'c1', token: 't1', apiUrl: 'https://x.test' });
  // script copied
  expect(fs.existsSync(path.join(dir, 'codepet', 'codepet-live.mjs'))).toBe(true);
  const settings = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  for (const evt of ['SessionStart', 'PostToolUse', 'Stop']) {
    const cmds = (settings.hooks[evt] ?? []).flatMap((g) => g.hooks.map((h) => h.command));
    expect(cmds.some((c) => c.includes('codepet-live.mjs'))).toBe(true);
  }
});
```
(If the test file has no `mkTmpClaudeDir`/imports, mirror the existing setup in that file — use `fs`, `os.tmpdir()`, `path`, and the same import of `installTracking`.)

- [ ] **Step 2: Run to verify fail**

Run: `yarn vitest run lib/installer/tracking.test.mjs`
Expected: FAIL (no live script, no live hooks).

- [ ] **Step 3: Implement** — in `lib/installer/tracking.mjs`:

Add a source helper next to `trackerSource`:
```js
/** Repo source of the live-activity hook script. */
export function liveSource(cwd = process.cwd()) {
  return path.join(cwd, 'toolkit', 'hooks', 'codepet-live.mjs');
}
```
In `installTracking`, after the tracker script + `track.json` are written and the `SessionEnd` hook is merged, add:
```js
  // Live-activity emitter: copy the script and register the three during-session hooks.
  const liveTarget = path.join(codepetDir, 'codepet-live.mjs');
  fs.writeFileSync(liveTarget, fs.readFileSync(liveSource(cwd), 'utf8'));
  const liveEntry = { type: 'command', command: `node ${liveTarget}` };
  for (const evt of ['SessionStart', 'PostToolUse', 'Stop']) {
    settings = mergeHook(settings, evt, liveEntry);
  }
```
Ensure this runs against the same `settings` object that is written back to `settings.json` (place it before the final `writeFileSync(settingsTarget, …)`), and add `liveTarget`/`live` to the returned paths object:
```js
  return { script: scriptTarget, config: configTarget, settings: settingsTarget, live: liveTarget };
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run lib/installer/tracking.test.mjs lib/installer/settings.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/installer/tracking.mjs lib/installer/tracking.test.mjs
git commit -m "feat(build-coach): install live-activity hooks with the tracker"
```

---

### Task 6: `/api/track/live` ingest endpoint

**Files:**
- Create: `app/api/track/live/route.ts`
- Modify: `lib/firebase/schema.ts` (path helper)
- Test: `lib/liveBuild.test.ts` already covers the reducer; add a small `sanitizeLiveEvent` test in a new `app/api/track/live/sanitize.test.ts` OR co-locate a pure `sanitizeLiveEvent` in `lib/liveBuild.ts` and test it there.

Decision: put `sanitizeLiveEvent(raw): LiveEvent | null` in `lib/liveBuild.ts` (pure, testable), and have the route call it.

**Interfaces:**
- Consumes: `reduceLive`, `sanitizeLiveEvent` (Task 2 module), `adminDb`, `paths.liveBuild`.
- Produces: upserts `companies/{companyId}/liveBuilds/{buildSessionId}` via a transaction.

- [ ] **Step 1: Write failing test** — add to `lib/liveBuild.test.ts`:

```ts
import { sanitizeLiveEvent } from './liveBuild';

describe('sanitizeLiveEvent', () => {
  it('accepts a well-formed tool event', () => {
    const e = sanitizeLiveEvent({ buildSessionId: 'b', sessionId: 's', kind: 'tool', tool: 'Edit' });
    expect(e).toMatchObject({ buildSessionId: 'b', sessionId: 's', kind: 'tool', tool: 'Edit' });
    expect(typeof e?.ts).toBe('number');
  });
  it('rejects unknown kinds and missing ids', () => {
    expect(sanitizeLiveEvent({ buildSessionId: 'b', sessionId: 's', kind: 'nope' })).toBeNull();
    expect(sanitizeLiveEvent({ sessionId: 's', kind: 'tool' })).toBeNull();
    expect(sanitizeLiveEvent(null)).toBeNull();
  });
  it('drops tool for non-tool kinds', () => {
    const e = sanitizeLiveEvent({ buildSessionId: 'b', sessionId: 's', kind: 'turn', tool: 'X' });
    expect(e?.tool).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `yarn vitest run lib/liveBuild.test.ts`
Expected: FAIL (`sanitizeLiveEvent` undefined).

- [ ] **Step 3: Implement `sanitizeLiveEvent`** in `lib/liveBuild.ts` (append):

```ts
const KINDS = ['start', 'tool', 'turn'] as const;

/** Coerce an untrusted body into a LiveEvent (ts stamped here). Returns null if
 *  ids are missing or the kind is unknown. */
export function sanitizeLiveEvent(raw: unknown): LiveEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const buildSessionId = typeof r.buildSessionId === 'string' ? r.buildSessionId.trim().slice(0, 128) : '';
  const sessionId = typeof r.sessionId === 'string' ? r.sessionId.trim().slice(0, 128) : '';
  const kind = KINDS.find((k) => k === r.kind);
  if (!buildSessionId || !sessionId || !kind) return null;
  const tool =
    kind === 'tool' && typeof r.tool === 'string' && r.tool.trim()
      ? r.tool.trim().slice(0, 64)
      : undefined;
  return { buildSessionId, sessionId, kind, tool, ts: Date.now() };
}
```

- [ ] **Step 4: Add the path helper** — in `lib/firebase/schema.ts` `paths` object:

```ts
  liveBuilds: (companyId: string) => `companies/${companyId}/liveBuilds`,
  liveBuild: (companyId: string, buildSessionId: string) =>
    `companies/${companyId}/liveBuilds/${buildSessionId}`,
  notebook: (companyId: string) => `companies/${companyId}/notebook`,
```

- [ ] **Step 5: Implement the route** — `app/api/track/live/route.ts`:

```ts
// Live-activity ingest for the Build Coach DURING meter. The local hooks (see
// toolkit/hooks/codepet-live.mjs) POST one LiveEvent per SessionStart/PostToolUse/Stop.
// Auth is the per-company ingest token, checked against the company doc (same as
// /api/track). The event is folded into liveBuilds/{buildSessionId} via reduceLive
// inside a transaction so concurrent tool events don't clobber each other.
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { paths } from '@/lib/firebase/schema';
import { reduceLive, sanitizeLiveEvent, type LiveState } from '@/lib/liveBuild';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const { companyId, token, event } = (body ?? {}) as {
    companyId?: string;
    token?: string;
    event?: unknown;
  };
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

  const clean = sanitizeLiveEvent(event);
  if (!clean) {
    return NextResponse.json({ error: 'invalid event' }, { status: 400 });
  }

  const ref = db.doc(paths.liveBuild(companyId, clean.buildSessionId));
  await db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    const prev = cur.exists ? (cur.data() as LiveState) : null;
    const next = reduceLive(prev, clean);
    tx.set(ref, next);
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: Run tests + typecheck**

Run: `yarn vitest run lib/liveBuild.test.ts && yarn typecheck`
Expected: PASS + clean typecheck.

- [ ] **Step 7: Commit**

```bash
git add lib/liveBuild.ts lib/firebase/schema.ts app/api/track/live/route.ts
git commit -m "feat(build-coach): /api/track/live ingest + liveBuilds path helpers"
```

---

### Task 7: `armBuildSession` server action

**Files:**
- Create: `app/actions/build.ts`
- (No unit test — fs write + `osascript` spawn is an untested shell; its pure inputs `buildOpeningPrompt`/`terminalCommand` are tested in Task 3. Verified in the manual e2e pass.)

**Interfaces:**
- Consumes: `detectCapability`, `resolveClaudeDir`, `buildOpeningPrompt`, `terminalCommand`, `BytePlan`.
- Produces:
  ```ts
  interface ArmInput { buildSessionId: string; projectDir: string; plan: BytePlan; audience: string; doneLooks: string; companyId: string; token: string; apiUrl: string; }
  armBuildSession(input: ArmInput): Promise<{ ok: true; launched: boolean } | { ok: false; reason: 'remote'; command: string }>
  ```
  `launched` is true when a Terminal was opened (macOS local mode); false + `command` returned when the caller should show a copy-paste line.

- [ ] **Step 1: Implement** — `app/actions/build.ts`:

```ts
'use server';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { detectCapability } from '@/lib/installer/capability.mjs';
import { resolveClaudeDir } from '@/lib/installer/paths.mjs';
import { buildOpeningPrompt, terminalCommand } from '@/lib/armSession';
import type { BytePlan } from '@/lib/ai/plan';

interface ArmInput {
  buildSessionId: string;
  projectDir: string;
  plan: BytePlan;
  audience: string;
  doneLooks: string;
  companyId: string;
  token: string;
  apiUrl: string;
}

function writeArmFile(claudeDir: string, input: ArmInput) {
  const dir = path.join(claudeDir, 'codepet');
  fs.mkdirSync(dir, { recursive: true });
  const { buildSessionId, projectDir, plan, audience, doneLooks, companyId, token, apiUrl } = input;
  fs.writeFileSync(
    path.join(dir, 'current-build.json'),
    JSON.stringify(
      { buildSessionId, projectDir, plan, audience, doneLooks, companyId, token, apiUrl, startedAt: Date.now() },
      null,
      2,
    ),
  );
}

export async function armBuildSession(input: ArmInput) {
  const prompt = buildOpeningPrompt(input.plan, input.audience, input.doneLooks);
  const command = terminalCommand(input.projectDir, prompt);

  if (detectCapability(process.env).mode === 'remote') {
    return { ok: false as const, reason: 'remote' as const, command };
  }

  writeArmFile(resolveClaudeDir(), input);

  // macOS-first Terminal open. Other platforms: no launch, caller shows the command.
  if (process.platform === 'darwin') {
    const script = `tell application "Terminal" to do script ${JSON.stringify(command)}\ntell application "Terminal" to activate`;
    try {
      spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true as const, launched: true };
    } catch {
      return { ok: true as const, launched: false };
    }
  }
  return { ok: true as const, launched: false };
}
```

Note: `JSON.stringify(command)` produces a valid AppleScript double-quoted string (escapes `"` and `\`), so the shell command survives the osascript layer.

- [ ] **Step 2: Typecheck**

Run: `yarn typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/actions/build.ts
git commit -m "feat(build-coach): armBuildSession server action (arm-file + Terminal open)"
```

---

### Task 8: live-build client subscription + notebook write

**Files:**
- Modify: `lib/firebase/companyData.ts`
- (No unit test — thin Firestore SDK wrappers; exercised by the manual e2e pass. Keep them minimal.)

**Interfaces:**
- Produces:
  ```ts
  subscribeLiveBuild(companyId: string, buildSessionId: string, cb: (state: LiveState | null) => void): () => void
  loadTrackEventForSession(companyId: string, sessionId: string): Promise<TrackEvent | null>
  writeNotebookNote(companyId: string, note: { buildSessionId: string; doneLooks: string; wins: string[] }): Promise<void>
  ```

- [ ] **Step 1: Implement** — add to `lib/firebase/companyData.ts` (follow the file's existing client-SDK import style — `onSnapshot`, `doc`, `collection`, `query`, `where`, `getDocs`, `addDoc`, `serverTimestamp` from `firebase/firestore`, and the app's `db()` accessor used elsewhere in the file):

```ts
import type { LiveState } from '../liveBuild';
import type { TrackEvent } from '../tracking';

/** Live-subscribe to a build's activity doc. Returns an unsubscribe fn. */
export function subscribeLiveBuild(
  companyId: string,
  buildSessionId: string,
  cb: (state: LiveState | null) => void,
): () => void {
  const ref = doc(db(), paths.liveBuild(companyId, buildSessionId));
  return onSnapshot(
    ref,
    (snap) => cb(snap.exists() ? (snap.data() as LiveState) : null),
    () => cb(null),
  );
}

/** The most recent trackEvent for a given session id (the SessionEnd rollup). */
export async function loadTrackEventForSession(
  companyId: string,
  sessionId: string,
): Promise<TrackEvent | null> {
  const q = query(collection(db(), paths.trackEvents(companyId)), where('sessionId', '==', sessionId));
  const rows = await getDocs(q);
  const events = rows.docs.map((d) => d.data() as TrackEvent);
  events.sort((a, b) => b.ts - a.ts);
  return events[0] ?? null;
}

/** Append a small note to the company notebook (Build Coach END "write to memory"). */
export async function writeNotebookNote(
  companyId: string,
  note: { buildSessionId: string; doneLooks: string; wins: string[] },
): Promise<void> {
  await addDoc(collection(db(), paths.notebook(companyId)), { ...note, ts: Date.now() });
}
```

(Match the file's actual accessor names — if it uses `getDb()` or a module-level `firestore`, use that instead of `db()`. Add any missing imports to the existing `firebase/firestore` import line.)

- [ ] **Step 2: Typecheck**

Run: `yarn typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/firebase/companyData.ts
git commit -m "feat(build-coach): live-build subscription + trackEvent + notebook readers"
```

---

### Task 9: DURING step — real live meter

**Files:**
- Modify: `components/views/BuildCoachView.tsx`

**Interfaces:**
- Consumes: `subscribeLiveBuild`, `budgetState`, `DANGER_PCT`, the active `BytePlan` + `buildSessionId` + `companyId` (lifted into `BuildCoachView` state — see Task 11).

- [ ] **Step 1: Rewrite `DuringStep`** to subscribe instead of using a slider. New props:

```tsx
function DuringStep({
  companyId,
  buildSessionId,
  plan,
  unlocked,
  onUnlock,
}: {
  companyId: string;
  buildSessionId: string | null;
  plan: BytePlan | null;
  unlocked: boolean;
  onUnlock: () => void;
}) {
  const [live, setLive] = useState<LiveState | null>(null);
  useEffect(() => {
    if (!companyId || !buildSessionId) return;
    return subscribeLiveBuild(companyId, buildSessionId, setLive);
  }, [companyId, buildSessionId]);

  const target = plan?.budgetActions ?? 12;
  const actions = live?.actionCount ?? 0;
  const pct = Math.min(100, Math.round((actions / target) * 100));
  const bs = budgetState(pct);
  useEffect(() => {
    if (bs.unlock) onUnlock();
  }, [bs.unlock, onUnlock]);

  // …render the existing meter markup, but:
  //  - fill width = `${pct}%`, warn class from bs.warn
  //  - replace the <input type=range> row with a live read-out:
  //      `<span className="bc-pct">{actions} / {target} actions</span>`
  //  - show recentTools as Byte's narration when present
  //  - when buildSessionId is null OR live is null: "Waiting for Byte to see your session…"
}
```

Import at top of file: `import { useEffect } from 'react';` (extend the existing `useState` import), `import { subscribeLiveBuild } from '@/lib/firebase/companyData';`, `import type { LiveState } from '@/lib/liveBuild';`.

Keep all existing `CoachBubble` copy and `.bc-*` classnames; only the slider row and its `spentK` math are removed.

- [ ] **Step 2: Typecheck + lint**

Run: `yarn typecheck && yarn lint`
Expected: clean (no unused `setPct`/`spentK`).

- [ ] **Step 3: Commit**

```bash
git add components/views/BuildCoachView.tsx
git commit -m "feat(build-coach): DURING meter driven by real live activity"
```

---

### Task 10: END step — real recap + notebook write

**Files:**
- Modify: `components/views/BuildCoachView.tsx`

**Interfaces:**
- Consumes: `loadTrackEventForSession`, `writeNotebookNote`, the session's `TrackEvent`, `plan`, `doneLooks`, `live.actionCount`.

- [ ] **Step 1: Rewrite `EndStep`** to take real data:

```tsx
function EndStep({
  companyId,
  sessionId,
  plan,
  doneLooks,
  actions,
}: {
  companyId: string;
  sessionId: string | null;
  plan: BytePlan | null;
  doneLooks: string;
  actions: number;
}) {
  const [ev, setEv] = useState<TrackEvent | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!companyId || !sessionId) return;
    loadTrackEventForSession(companyId, sessionId).then(setEv);
  }, [companyId, sessionId]);

  const target = plan?.budgetActions ?? 12;
  const underBudget = actions <= target;
  const earned = underBudget && (ev?.commits ?? 0) >= 1;

  const save = async () => {
    if (!companyId || saved) return;
    await writeNotebookNote(companyId, {
      buildSessionId: sessionId ?? '',
      doneLooks,
      wins: ev?.wins ?? [],
    });
    setSaved(true);
  };

  // Recap grid: `built` = ev?.wins[0] ?? doneLooks; `spent` = `${actions}/${target}`
  //   (class 'ok' when underBudget, else warn); `checked` = earned ? 'passed! 🎯' : '—'.
  // Checklist: one <li> per plan.steps, plus a "matches what 'done' looks like" row echoing doneLooks.
  // Habit card: earned → "Byte earned the Double-check habit"; else encouraging "next time" copy.
  // "Write to notebook" button → save(); show saved state. When ev is null: "Byte is still tidying up the session…"
}
```

Add imports: `import { loadTrackEventForSession, writeNotebookNote } from '@/lib/firebase/companyData';`, `import type { TrackEvent } from '@/lib/tracking';`.

- [ ] **Step 2: Typecheck + lint**

Run: `yarn typecheck && yarn lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/views/BuildCoachView.tsx
git commit -m "feat(build-coach): END recap from real trackEvent + notebook write"
```

---

### Task 11: START arm/launch wiring + container state

**Files:**
- Modify: `components/views/BuildCoachView.tsx`

**Interfaces:**
- Consumes: `armBuildSession`, `useApp()` (for `companyId`, `company.projects`, ingest token), `crypto.randomUUID()`.

- [ ] **Step 1: Lift shared state into `BuildCoachView`** — hold `plan`, `audience`, `doneLooks`, `buildSessionId`, `sessionId`, `liveActions`, `unlocked`. Pass down to the three steps. The `sessionId` for END is the live doc's `sessionId` once activity arrives (thread it up from the DURING subscription via a callback, or read the live doc in the container instead of DURING). Simplest: subscribe to the live build in the container once `buildSessionId` is set, keep `live` in container state, and pass `live` down to both DURING and END. Refactor the DURING subscription (Task 9) up to the container accordingly.

- [ ] **Step 2: START "Start building" button** — after a plan exists, render a launch button that:

```tsx
const { companyId, company } = useApp(); // match the real useApp() shape
const startBuild = async () => {
  if (!plan) return;
  const buildSessionId = crypto.randomUUID();
  const projectDir =
    company?.projects?.find((p) => p.name === project)?.path ?? project; // name → path
  const token = company?.ingestToken ?? '';
  const apiUrl = window.location.origin;
  const res = await armBuildSession({
    buildSessionId, projectDir, plan, audience, doneLooks, companyId, token, apiUrl,
  });
  setBuildSessionId(buildSessionId);
  setStep('during');
  if (res.ok === false || !res.launched) setLaunchCommand(res.ok === false ? res.command : /* macOS non-launch */ null);
};
```

(Adapt to the real `useApp()` return shape — check what it exposes for `companyId`/`company`/`ingestToken`. If `ingestToken` isn't on the client company object, mint/read it the same way `InstallView` does via `ensureIngestToken` — see the tracking spec addendum.)

- [ ] **Step 3: Fallback UI** — when `launchCommand` is set (remote, or non-macOS), show a copy-paste card in DURING: "Run this in your terminal:" + the command, and note the live meter needs local mode.

- [ ] **Step 4: Typecheck + lint + full test run**

Run: `yarn typecheck && yarn lint && yarn vitest run`
Expected: all clean/pass.

- [ ] **Step 5: Commit**

```bash
git add components/views/BuildCoachView.tsx
git commit -m "feat(build-coach): START arms + launches the live session"
```

---

## Manual e2e (real machine — cannot run in this environment)

1. Local install (First install) so `codepet-live.mjs` + hooks land in `~/.claude`.
2. Open Build Coach → fill START → generate plan → "Start building" → a Terminal opens running `claude` with the plan as the opening prompt.
3. In that session, make a few edits + a commit → DURING meter climbs by real actions, Byte flips to worried at ≥80% of `budgetActions`, `recentTools` narrate.
4. End the session → END shows real commit(s), awards the habit when under budget with ≥1 commit, "write to notebook" persists a note.
5. Remote/web mode → START shows the copy-paste command; no live meter; END still renders from the SessionEnd rollup on next load.

## Self-Review notes

- **Spec coverage:** ①START/arm → Tasks 3,7,11. ②hooks → Tasks 4,5. ③endpoint/Firestore → Tasks 2,6,8. ④DURING → Task 9. ⑤END → Task 10. Plan schema → Task 1. All spec components mapped.
- **Type consistency:** `LiveEvent`/`LiveState`/`reduceLive`/`sanitizeLiveEvent` defined in Task 2, consumed in Tasks 6,8,9. `budgetActions` defined Task 1, consumed Tasks 3,9,10,11. `armBuildSession` signature defined Task 7, consumed Task 11.
- **Known adaptation points (flagged inline, not placeholders):** the exact `useApp()` shape and `companyData.ts` db accessor must be matched to the real code during execution — Tasks 8 and 11 call this out explicitly.
```
