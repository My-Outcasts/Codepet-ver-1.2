# Build Coach — Byte narrates Claude Code responses — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** During the Build Coach's DURING step, have Byte re-interpret what Claude Code says each turn — and surface when Claude pauses to ask the user something — using a local, privacy-preserving heuristic.

**Architecture:** Reuse the existing live pipeline (`codepet-live.mjs` hook → `/api/track/live` → `liveBuilds/{id}` → `subscribeLiveBuild` → `DuringStep`). The hook gains two signals: on `Stop` it reads the transcript, extracts the last assistant text, and narrates it locally to one short Byte line; on the new `Notification` hook event it emits a "Claude is asking you" line. Only the short Byte line (never raw text) is POSTed. `reduceLive` folds `say`/`ask` into new `lastSay`/`pendingAsk` state; the UI's Byte bubble is driven by a pure selector.

**Tech Stack:** Next.js 16 (App Router, Node runtime), React 19, TypeScript, Firebase Admin (Firestore), Vitest (`*.test.ts`), `node --test` (`*.test.mjs`).

## Global Constraints

- Byte's narrated copy is in **English**, matching all existing Byte UI copy.
- The local hooks MUST NOT block, slow, or break a Claude Code session: every I/O step guarded with try/catch, POST keeps a short timeout, process always `exit 0`.
- Raw assistant text and raw notification messages stay on the local machine; only Byte's short line (≤160 chars) is POSTed.
- Firebase Admin has NO `ignoreUndefinedProperties`; objects written to Firestore MUST NOT contain `undefined` field values. The live route overwrites the doc with `tx.set` (no merge), so clearing a field = omitting the key.
- Follow existing patterns: pure logic in `.ts`/`.mjs` with colocated tests; hooks are self-contained ESM.
- Vitest tests run with `npm test`; installer/hook `.mjs` tests run with `npm run test:installer`.

---

### Task 1: Narration module (`narrate.mjs`)

Pure transcript-parsing + narration, unit-tested. Lives beside the hook so the hook's relative import resolves in-repo and after install.

**Files:**

- Create: `toolkit/hooks/narrate.mjs`
- Test: `toolkit/hooks/narrate.test.mjs`
- Modify: `package.json` (broaden `test:installer` to also scan `toolkit/hooks/`)

**Interfaces:**

- Produces:
  - `extractLastAssistantText(jsonl: string): string` — concatenated text of the last assistant message in a transcript JSONL string; `''` if none/unparseable.
  - `narrate(text: string, toolName?: string): string` — one short Byte-voice line; total (never throws).

- [ ] **Step 1: Point the installer test script at `toolkit/hooks/` too**

In `package.json`, change the `test:installer` script:

```json
    "test:installer": "node --test lib/installer/ toolkit/hooks/"
```

- [ ] **Step 2: Write the failing tests**

Create `toolkit/hooks/narrate.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { narrate, extractLastAssistantText } from './narrate.mjs';

test('extractLastAssistantText pulls the last assistant text (type:assistant)', () => {
  const jsonl = [
    JSON.stringify({ type: 'user', message: { content: 'hi' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'first' }] } }),
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'hmm' },
          { type: 'text', text: 'second' },
          { type: 'tool_use', name: 'Edit', input: {} },
        ],
      },
    }),
  ].join('\n');
  assert.equal(extractLastAssistantText(jsonl), 'second');
});

test('extractLastAssistantText supports type:message role:assistant', () => {
  const jsonl = JSON.stringify({
    type: 'message',
    role: 'assistant',
    message: { content: [{ type: 'text', text: 'hey' }] },
  });
  assert.equal(extractLastAssistantText(jsonl), 'hey');
});

test('extractLastAssistantText skips malformed lines and empties safely', () => {
  assert.equal(extractLastAssistantText('not json\n{bad'), '');
  assert.equal(extractLastAssistantText(''), '');
  assert.equal(extractLastAssistantText(null), '');
});

test('narrate classifies test intent', () => {
  assert.equal(
    narrate('I will add a test for login'),
    "Claude's running tests — nice, playing it safe 🧪",
  );
});

test('narrate classifies fix intent', () => {
  assert.equal(narrate('Fixing the bug in auth'), "Claude's patching something up 🔧");
});

test('narrate classifies build intent', () => {
  assert.equal(narrate('I will implement the form'), "Claude's building a new piece ✨");
});

test('narrate classifies tidy intent', () => {
  assert.equal(narrate('Let me refactor this module'), "Claude's tidying up the code 🧹");
});

test('narrate falls back to a cleaned snippet with no intent keyword', () => {
  const line = narrate('Here is the **plan** we should follow now.');
  assert.match(line, /^Byte sees Claude: "/);
  assert.ok(!line.includes('**'), 'markdown stripped');
});

test('narrate caps the snippet length', () => {
  const line = narrate('word '.repeat(80).trim()); // long, no keywords
  assert.ok(line.length <= 160, `got ${line.length}`);
});

test('narrate falls back to the tool name on empty text', () => {
  assert.equal(narrate('', 'Edit'), 'Byte sees Claude working with Edit…');
});

test('narrate handles no text and no tool', () => {
  assert.equal(narrate('', ''), "Claude's thinking it through…");
});

test('narrate never throws on odd input', () => {
  assert.doesNotThrow(() => narrate(null));
  assert.doesNotThrow(() => narrate(undefined, null));
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test toolkit/hooks/narrate.test.mjs`
Expected: FAIL — `Cannot find module './narrate.mjs'`.

- [ ] **Step 4: Write the implementation**

Create `toolkit/hooks/narrate.mjs`:

````js
// Local narration for the Build Coach live hook. Pure, framework-free, and
// unit-tested with `node --test`. The installed live hook (codepet-live.mjs)
// imports these to turn Claude's raw assistant text into ONE short Byte-voice
// line — WITHOUT the raw text ever leaving the machine. Kept beside the hook so
// the relative `import './narrate.mjs'` resolves in-repo and after install.
// See docs/superpowers/specs/2026-07-03-build-coach-response-narration-design.md.

const SNIPPET_CAP = 120;

/** Concatenate the LAST assistant message's text blocks from a transcript JSONL
 *  string. Accepts both observed entry shapes. Returns '' when none/unparseable. */
export function extractLastAssistantText(jsonl) {
  if (typeof jsonl !== 'string' || !jsonl.trim()) return '';
  let last = null;
  for (const line of jsonl.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let entry;
    try {
      entry = JSON.parse(t);
    } catch {
      continue;
    }
    const isAssistant =
      entry?.type === 'assistant' ||
      (entry?.type === 'message' && entry?.role === 'assistant') ||
      entry?.role === 'assistant';
    if (isAssistant) last = entry;
  }
  if (!last) return '';
  const content = last?.message?.content ?? last?.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/** Strip markdown noise, collapse whitespace, take the first sentence, hard-cap. */
function snippet(text) {
  const clean = text
    .replace(/```[\s\S]*?```/g, ' ') // fenced code
    .replace(/`[^`]*`/g, ' ') // inline code
    .replace(/[*_#>~]/g, ' ') // emphasis / headers / quotes
    .replace(/\s+/g, ' ')
    .trim();
  const firstSentence = clean.split(/(?<=[.!?])\s/)[0] ?? clean;
  return firstSentence.length > SNIPPET_CAP
    ? firstSentence.slice(0, SNIPPET_CAP).trim() + '…'
    : firstSentence;
}

/** Turn Claude's raw assistant text (and, as a fallback, the active tool name)
 *  into one short Byte-voice line. Deterministic; total (never throws). */
export function narrate(text, toolName) {
  const t = typeof text === 'string' ? text : '';
  const low = t.toLowerCase();
  if (/\btest(s|ing|ed)?\b/.test(low)) return "Claude's running tests — nice, playing it safe 🧪";
  if (/\b(fix|fixing|bug|error|broken)\b/.test(low)) return "Claude's patching something up 🔧";
  if (/\b(add|adding|create|implement|build|building|new)\b/.test(low))
    return "Claude's building a new piece ✨";
  if (/\b(refactor|clean|tidy|rename)\b/.test(low)) return "Claude's tidying up the code 🧹";
  if (t.trim()) return `Byte sees Claude: "${snippet(t)}"`;
  if (typeof toolName === 'string' && toolName.trim())
    return `Byte sees Claude working with ${toolName.trim()}…`;
  return "Claude's thinking it through…";
}
````

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test toolkit/hooks/narrate.test.mjs`
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add toolkit/hooks/narrate.mjs toolkit/hooks/narrate.test.mjs package.json
git commit -m "feat(build-coach): local narrate() + transcript text extractor"
```

---

### Task 2: Live reducer & wire format (`liveBuild.ts`)

Carry `say`/`ask` on the wire; fold into new `lastSay`/`pendingAsk` state; map the `Notification` hook event.

**Files:**

- Modify: `lib/liveBuild.ts`
- Test: `lib/liveBuild.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces:
  - `LiveEvent` gains `kind: 'ask'`, optional `say?: string`, optional `ask?: string`.
  - `LiveState` gains optional `lastSay?: string`, `pendingAsk?: string`.
  - `reduceLive` never returns an object containing an `undefined`-valued key.
  - `eventKindFor('Notification') === 'ask'`.
  - `sanitizeLiveEvent` accepts+caps `say` (on `turn`) and `ask` (on `ask`).

- [ ] **Step 1: Write the failing tests**

Append to `lib/liveBuild.test.ts` (inside the existing file, after the current `describe` blocks):

```ts
describe('reduceLive — narration', () => {
  const start = reduceLive(null, { ...base, kind: 'start', ts: 1 });

  it('turn stores the narrated line and bumps turns', () => {
    const s = reduceLive(start, {
      ...base,
      kind: 'turn',
      say: "Claude's building a new piece ✨",
      ts: 2,
    });
    expect(s.turns).toBe(1);
    expect(s.lastSay).toBe("Claude's building a new piece ✨");
  });

  it('turn without say keeps the previous lastSay', () => {
    const a = reduceLive(start, { ...base, kind: 'turn', say: 'first', ts: 2 });
    const b = reduceLive(a, { ...base, kind: 'turn', ts: 3 });
    expect(b.lastSay).toBe('first');
    expect(b).not.toHaveProperty('lastSay', undefined);
  });

  it('ask sets pendingAsk', () => {
    const s = reduceLive(start, { ...base, kind: 'ask', ask: 'answer me', ts: 2 });
    expect(s.pendingAsk).toBe('answer me');
  });

  it('a tool event clears a pending ask and never leaves an undefined key', () => {
    const asked = reduceLive(start, { ...base, kind: 'ask', ask: 'answer me', ts: 2 });
    const s = reduceLive(asked, { ...base, kind: 'tool', tool: 'Edit', ts: 3 });
    expect(s.actionCount).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(s, 'pendingAsk')).toBe(false);
  });

  it('start clears narration state', () => {
    const asked = reduceLive(start, { ...base, kind: 'ask', ask: 'answer me', ts: 2 });
    const s = reduceLive(asked, { ...base, kind: 'start', ts: 9 });
    expect(Object.prototype.hasOwnProperty.call(s, 'pendingAsk')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(s, 'lastSay')).toBe(false);
  });
});

describe('eventKindFor — Notification', () => {
  it('maps Notification to ask', () => {
    expect(eventKindFor('Notification')).toBe('ask');
  });
});

describe('sanitizeLiveEvent — narration', () => {
  it('keeps say on a turn and caps its length', () => {
    const e = sanitizeLiveEvent({
      buildSessionId: 'b',
      sessionId: 's',
      kind: 'turn',
      say: 'x'.repeat(500),
    });
    expect(e?.kind).toBe('turn');
    expect(e?.say?.length).toBe(160);
  });
  it('keeps ask on an ask event and requires a valid kind', () => {
    const e = sanitizeLiveEvent({ buildSessionId: 'b', sessionId: 's', kind: 'ask', ask: 'hi' });
    expect(e).toEqual(expect.objectContaining({ kind: 'ask', ask: 'hi' }));
  });
  it('drops say/ask on the wrong kind', () => {
    const e = sanitizeLiveEvent({
      buildSessionId: 'b',
      sessionId: 's',
      kind: 'tool',
      tool: 'Edit',
      say: 'nope',
      ask: 'nope',
    });
    expect(e).not.toHaveProperty('say');
    expect(e).not.toHaveProperty('ask');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/liveBuild.test.ts`
Expected: FAIL — `eventKindFor('Notification')` returns null; `say`/`ask`/`lastSay`/`pendingAsk` undefined; TS errors on `kind: 'ask'`.

- [ ] **Step 3: Update the types and `initialLive`**

In `lib/liveBuild.ts`, replace the `LiveEvent` and `LiveState` interfaces:

```ts
export interface LiveEvent {
  buildSessionId: string;
  sessionId: string;
  kind: 'start' | 'tool' | 'turn' | 'ask';
  tool?: string;
  /** Byte's narrated line for this turn (already produced locally by the hook). */
  say?: string;
  /** Byte's "Claude is waiting on you" line, on an `ask` event. */
  ask?: string;
  ts: Millis;
}

export interface LiveState {
  sessionId: string;
  actionCount: number;
  turns: number;
  recentTools: string[];
  startedAt: Millis;
  lastTs: Millis;
  ended: boolean;
  /** Byte's most recent narrated line for the DURING bubble. */
  lastSay?: string;
  /** Set while Claude is waiting on the user; cleared when a tool event lands. */
  pendingAsk?: string;
}
```

`initialLive` is unchanged (it simply omits the optional keys, which is the clean state).

- [ ] **Step 4: Update `reduceLive` (undefined-safe)**

Replace the `reduceLive` function body:

```ts
/** Drop keys whose value is undefined — Firestore's Admin SDK rejects undefined
 *  field values, and the live route overwrites the doc with `set` (no merge), so
 *  omitting a key is how we clear it. */
function prune(state: LiveState): LiveState {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(state)) if (v !== undefined) out[k] = v;
  return out as unknown as LiveState;
}

export function reduceLive(state: LiveState | null, event: LiveEvent): LiveState {
  const sessionId = event.sessionId || state?.sessionId || '';
  if (event.kind === 'start') return initialLive(event.ts, sessionId);
  const s = state ?? initialLive(event.ts, sessionId);
  if (event.kind === 'tool') {
    const recentTools = event.tool
      ? [...s.recentTools, event.tool].slice(-RECENT_TOOLS_CAP)
      : s.recentTools;
    // A tool means Claude resumed after any question — clear the pending ask.
    return prune({
      ...s,
      sessionId,
      actionCount: s.actionCount + 1,
      recentTools,
      pendingAsk: undefined,
      lastTs: event.ts,
    });
  }
  if (event.kind === 'ask') {
    return prune({ ...s, sessionId, pendingAsk: event.ask, lastTs: event.ts });
  }
  // kind === 'turn'
  return prune({
    ...s,
    sessionId,
    turns: s.turns + 1,
    lastSay: event.say ?? s.lastSay,
    lastTs: event.ts,
  });
}
```

- [ ] **Step 5: Update `eventKindFor`, `KINDS`, and `sanitizeLiveEvent`**

Change the `Notification` mapping in `eventKindFor` (add a case before `default`):

```ts
    case 'Notification':
      return 'ask';
```

Change the `KINDS` tuple:

```ts
const KINDS = ['start', 'tool', 'turn', 'ask'] as const;
```

Replace the tail of `sanitizeLiveEvent` (from the `tool` line to the return):

```ts
const tool =
  kind === 'tool' && typeof r.tool === 'string' && r.tool.trim()
    ? r.tool.trim().slice(0, 64)
    : undefined;
const say =
  kind === 'turn' && typeof r.say === 'string' && r.say.trim()
    ? r.say.trim().slice(0, 160)
    : undefined;
const ask =
  kind === 'ask' && typeof r.ask === 'string' && r.ask.trim()
    ? r.ask.trim().slice(0, 160)
    : undefined;
const out: LiveEvent = { buildSessionId, sessionId, kind, ts: Date.now() };
if (tool !== undefined) out.tool = tool;
if (say !== undefined) out.say = say;
if (ask !== undefined) out.ask = ask;
return out;
```

(The previous implementation returned `{ ..., tool, ts }` with `tool` possibly
undefined; the new form only attaches defined fields so no `undefined` reaches
Firestore via the route.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run lib/liveBuild.test.ts`
Expected: PASS (existing + new tests).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add lib/liveBuild.ts lib/liveBuild.test.ts
git commit -m "feat(build-coach): live say/ask events + lastSay/pendingAsk state"
```

---

### Task 3: Live hook emits say/ask (`codepet-live.mjs`)

Wire the hook to narrate on `Stop` and emit the ask line on `Notification`.

**Files:**

- Modify: `toolkit/hooks/codepet-live.mjs`

**Interfaces:**

- Consumes: `narrate`, `extractLastAssistantText` from `./narrate.mjs` (Task 1); the wire fields `say`/`ask`/`kind: 'ask'` accepted by `/api/track/live` (Task 2).
- Produces: LiveEvents with `say` (on `turn`) / `ask` (on `ask`).

- [ ] **Step 1: Add the import and extend `kindFor`**

At the top of `toolkit/hooks/codepet-live.mjs`, add the import after the node builtins:

```js
import { narrate, extractLastAssistantText } from './narrate.mjs';
```

Replace `kindFor`:

```js
function kindFor(name) {
  if (name === 'SessionStart') return 'start';
  if (name === 'PostToolUse') return 'tool';
  if (name === 'Stop') return 'turn';
  if (name === 'Notification') return 'ask';
  return null;
}
```

- [ ] **Step 2: Build the event with say/ask**

Replace the `const event = { ... }` block in `main()` with:

```js
const event = {
  buildSessionId: build.buildSessionId,
  sessionId: input.session_id || `sess-${Date.now()}`,
  kind,
  ts: Date.now(),
};
if (kind === 'tool') {
  event.tool = input.tool_name;
} else if (kind === 'turn') {
  // Narrate what Claude just said — locally, so the raw text never leaves the
  // machine. Any failure just omits `say`; the turn still counts.
  try {
    if (input.transcript_path) {
      const line = narrate(
        extractLastAssistantText(fs.readFileSync(input.transcript_path, 'utf8')),
      );
      if (line) event.say = line;
    }
  } catch {
    // transcript unreadable — emit the bare turn
  }
} else if (kind === 'ask') {
  event.ask = "Claude's waiting on you — hop back to the Terminal and answer 🙋";
}
```

- [ ] **Step 3: Smoke-test the hook (Stop with a transcript)**

Run:

```bash
TMP=$(mktemp -d); mkdir -p "$TMP/codepet"
echo '{"buildSessionId":"b1"}' > "$TMP/codepet/current-build.json"
echo '{"companyId":"c1","token":"t","apiUrl":"http://127.0.0.1:9"}' > "$TMP/codepet/track.json"
printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"I will add a test"}]}}' > "$TMP/t.jsonl"
echo "{\"hook_event_name\":\"Stop\",\"session_id\":\"s1\",\"transcript_path\":\"$TMP/t.jsonl\"}" \
  | CODEPET_CLAUDE_DIR="$TMP" node toolkit/hooks/codepet-live.mjs; echo "exit=$?"
```

Expected: `exit=0` (the POST to the unreachable URL fails silently; the process never throws — proving the guard + `import './narrate.mjs'` resolve correctly).

- [ ] **Step 4: Smoke-test the Notification path**

Run:

```bash
echo '{"hook_event_name":"Notification","session_id":"s1","message":"needs permission"}' \
  | CODEPET_CLAUDE_DIR="$TMP" node toolkit/hooks/codepet-live.mjs; echo "exit=$?"
```

Expected: `exit=0`.

- [ ] **Step 5: Commit**

```bash
git add toolkit/hooks/codepet-live.mjs
git commit -m "feat(build-coach): hook narrates Stop turns + emits Notification asks"
```

---

### Task 4: Installer registers Notification + installs narrate.mjs (`tracking.mjs`)

**Files:**

- Modify: `lib/installer/tracking.mjs`
- Test: `lib/installer/tracking.test.mjs`

**Interfaces:**

- Consumes: `toolkit/hooks/narrate.mjs` (Task 1) as an install source.
- Produces: `narrateSource(cwd)`; `LIVE_HOOK_EVENTS` includes `'Notification'`; `installTracking` writes `~/.claude/codepet/narrate.mjs` and returns its path as `narrate`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/installer/tracking.test.mjs`:

```js
test('installTracking registers the Notification live hook', () => {
  const dir = tmp();
  installTracking(dir, cfg);
  const settings = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  const cmds = (settings.hooks.Notification ?? []).flatMap((g) => g.hooks.map((h) => h.command));
  assert.ok(
    cmds.some((c) => c.includes('codepet-live.mjs')),
    'Notification hook registers the live emitter',
  );
});

test('installTracking copies narrate.mjs beside the live hook', () => {
  const dir = tmp();
  const paths = installTracking(dir, cfg);
  const narratePath = path.join(dir, 'codepet', 'narrate.mjs');
  assert.ok(fs.existsSync(narratePath), 'narrate.mjs copied');
  assert.equal(paths.narrate, narratePath, 'returns the narrate path');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test lib/installer/tracking.test.mjs`
Expected: FAIL — no `Notification` hook; `narrate.mjs` missing; `paths.narrate` undefined.

- [ ] **Step 3: Add `narrateSource` and register `Notification`**

In `lib/installer/tracking.mjs`, add after `liveSource`:

```js
/** Repo source of the narration module installed beside the live hook. */
export function narrateSource(cwd = process.cwd()) {
  return path.join(cwd, 'toolkit', 'hooks', 'narrate.mjs');
}
```

Change `LIVE_HOOK_EVENTS`:

```js
export const LIVE_HOOK_EVENTS = ['SessionStart', 'PostToolUse', 'Stop', 'Notification'];
```

- [ ] **Step 4: Copy `narrate.mjs` in `installTracking`**

In `installTracking`, immediately after the `liveTarget` write
(`fs.writeFileSync(liveTarget, fs.readFileSync(liveSource(cwd), 'utf8'));`), add:

```js
const narrateTarget = path.join(codepetDir, 'narrate.mjs');
fs.writeFileSync(narrateTarget, fs.readFileSync(narrateSource(cwd), 'utf8'));
```

Then update the return statement to include it:

```js
return {
  script: scriptTarget,
  config: configTarget,
  settings: settingsTarget,
  live: liveTarget,
  narrate: narrateTarget,
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test lib/installer/tracking.test.mjs`
Expected: PASS (existing + new tests). The existing "installs the live emitter script and its three hooks" and "idempotent" tests still pass because they only assert their named events are present / not duplicated.

- [ ] **Step 6: Commit**

```bash
git add lib/installer/tracking.mjs lib/installer/tracking.test.mjs
git commit -m "feat(build-coach): install narrate.mjs + register Notification hook"
```

---

### Task 5: Byte bubble reflects narration (`buildCoach.ts` + `DuringStep`)

Pure selector for the bubble line/mood, then wire it into the view.

**Files:**

- Modify: `lib/buildCoach.ts`
- Test: `lib/buildCoach.test.ts`
- Modify: `components/views/BuildCoachView.tsx` (`DuringStep`)

**Interfaces:**

- Consumes: `LiveState.pendingAsk`, `LiveState.lastSay` (Task 2); `budgetState(...).warn`.
- Produces: `byteDuringLine(live, warn): { say: string; mood: 'idle' | 'worried' } | null`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/buildCoach.test.ts`:

```ts
import { byteDuringLine } from './buildCoach';

describe('byteDuringLine', () => {
  it('prioritises a pending ask with a worried mood', () => {
    expect(byteDuringLine({ pendingAsk: 'answer me', lastSay: 'x' }, false)).toEqual({
      say: 'answer me',
      mood: 'worried',
    });
  });

  it('shows the latest narrated line, mood following the budget', () => {
    expect(byteDuringLine({ lastSay: 'building' }, false)).toEqual({
      say: 'building',
      mood: 'idle',
    });
    expect(byteDuringLine({ lastSay: 'building' }, true)).toEqual({
      say: 'building',
      mood: 'worried',
    });
  });

  it('returns null when there is nothing to narrate', () => {
    expect(byteDuringLine(null, false)).toBeNull();
    expect(byteDuringLine({}, true)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/buildCoach.test.ts`
Expected: FAIL — `byteDuringLine` is not exported.

- [ ] **Step 3: Implement `byteDuringLine`**

Append to `lib/buildCoach.ts`:

```ts
/** Minimal shape the DURING bubble reads from the live doc. */
export interface DuringNarration {
  pendingAsk?: string;
  lastSay?: string;
}

/** Byte's DURING bubble line + mood, in priority order: a pending question wins
 *  (worried), else the latest narrated line (mood follows the budget), else null
 *  so the caller keeps its default copy. */
export function byteDuringLine(
  live: DuringNarration | null,
  warn: boolean,
): { say: string; mood: 'idle' | 'worried' } | null {
  if (live?.pendingAsk) return { say: live.pendingAsk, mood: 'worried' };
  if (live?.lastSay) return { say: live.lastSay, mood: warn ? 'worried' : 'idle' };
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/buildCoach.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into `DuringStep`**

In `components/views/BuildCoachView.tsx`, update the `import` from `@/lib/buildCoach`:

```tsx
import { budgetState, byteDuringLine, DANGER_PCT } from '@/lib/buildCoach';
```

In `DuringStep`, replace the `<CoachBubble .../>` block. The current block is:

```tsx
      <CoachBubble
        mood={bs.warn ? 'worried' : 'idle'}
        say={
          bs.warn
            ? "Whoa, we're using a lot of steps! Let's slow down and double-check before we go further 😟"
            : live
              ? "Byte's watching your session — every step lands here in real time 👀"
              : 'Byte is waiting to see your session start…'
        }
        lens="🐷 It's like feeding a piggy bank"
```

Replace it with (compute the line just above the `return`, then use it):

```tsx
      <CoachBubble
        mood={line?.mood ?? (bs.warn ? 'worried' : 'idle')}
        say={
          line?.say ??
          (bs.warn
            ? "Whoa, we're using a lot of steps! Let's slow down and double-check before we go further 😟"
            : live
              ? "Byte's watching your session — every step lands here in real time 👀"
              : 'Byte is waiting to see your session start…')
        }
        lens="🐷 It's like feeding a piggy bank"
```

And add this line in `DuringStep` right after `const recent = live?.recentTools ?? [];`:

```tsx
const line = byteDuringLine(live, bs.warn);
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (`live` is `LiveState | null`; `byteDuringLine` accepts the narrower `DuringNarration | null` structurally.)

- [ ] **Step 7: Commit**

```bash
git add lib/buildCoach.ts lib/buildCoach.test.ts components/views/BuildCoachView.tsx
git commit -m "feat(build-coach): DURING bubble narrates lastSay + surfaces pendingAsk"
```

---

### Task 6: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: PASS (all vitest suites, incl. `liveBuild` + `buildCoach`).

- [ ] **Step 2: Run installer + hook tests**

Run: `npm run test:installer`
Expected: PASS (`lib/installer/*` + `toolkit/hooks/narrate.test.mjs`).

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: End-to-end manual check (real session)**

1. Reinstall the toolkit so the new hook + `narrate.mjs` land in `~/.claude/codepet/` and the `Notification` hook registers (use the app's install flow or `node scripts/install-toolkit.mjs --track <companyId> <token> <apiUrl>`).
2. In the app, arm a build from the START step and let it open `claude`.
3. Confirm the DURING bubble updates with Byte's narrated lines as Claude works.
4. Trigger a permission prompt in the session; confirm Byte flips to the worried "Claude's waiting on you…" line, then returns to narrating after you answer and Claude runs a tool.

- [ ] **Step 5: Final commit (if any manual-fix touch-ups were needed)**

```bash
git add -A && git commit -m "chore(build-coach): response-narration verification touch-ups"
```

---

## Self-Review

**Spec coverage:**

- Narration module (`extractLastAssistantText` + `narrate`, English, local, total) → Task 1. ✓
- Live hook `Stop`→say and `Notification`→ask, guarded, exit 0 → Task 3. ✓
- Reducer `say`/`ask` + `lastSay`/`pendingAsk`, tool clears pendingAsk, undefined-safe, `eventKindFor('Notification')`, sanitize caps → Task 2. ✓
- UI priority pendingAsk → lastSay → default → Task 5. ✓
- Installer `Notification` + copy `narrate.mjs` + test-script broadening → Task 1 (script) + Task 4. ✓
- Privacy (only Byte's line on the wire) → enforced by Task 3 (narrate locally) + Task 2 sanitize cap. ✓
- Testing plan (narrate branches, reducer transitions, installer assertions, manual e2e) → Tasks 1,2,4,6. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows full code. ✓

**Type consistency:** `narrate`/`extractLastAssistantText` signatures identical across Tasks 1/3; `LiveEvent`/`LiveState` fields (`say`, `ask`, `lastSay`, `pendingAsk`) consistent Tasks 2/3/5; `byteDuringLine(live, warn)` shape consistent Tasks 5; `narrateSource`/`paths.narrate` consistent Task 4. ✓
