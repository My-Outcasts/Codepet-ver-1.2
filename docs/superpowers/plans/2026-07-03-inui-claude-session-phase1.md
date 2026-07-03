# In-UI Claude Code session — Phase 1 (one-way streaming chat) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In local mode, "Let's build" spawns the real `claude` CLI headless in the chosen project and streams its response (assistant text + tool activity) into an in-UI chat transcript — proving the pipe end to end.

**Architecture:** The local Next.js server spawns `claude -p --input-format stream-json --output-format stream-json --verbose --permission-mode acceptEdits` (cwd = project), writes the opening prompt to stdin then closes it (one-shot for P1), parses stdout JSON lines into normalized `SessionEvent`s held per session in a module-level registry, and streams them to the browser over a long-lived `ReadableStream` (JSON-lines, same transport style as `/api/chat`). The UI folds events into a transcript via a pure reducer.

**Tech Stack:** Next.js 16 (App Router, `runtime = 'nodejs'`), React 19, TypeScript, `node:child_process`, Vitest (`*.test.ts`).

## Global Constraints

- **Local mode only.** Every route calls `detectCapability(process.env).mode` and returns `{ ok:false, reason:'remote' }` when not `'local'`. (`detectCapability` lives in `lib/installer/capability.mjs`.)
- **Streaming transport = long-lived `ReadableStream` of newline-delimited JSON**, returned as a `Response` with `content-type: application/x-ndjson` and `cache-control: no-store` — matching the `ReadableStream` pattern in `app/api/chat/route.ts` (NOT `EventSource`).
- **The `claude` child process persists across HTTP requests** via a module-level registry (`lib/liveSession/registry.ts`). Single-user local scope — in-memory, not persisted.
- **The engine must be unit-testable without the real `claude` binary**: `startSession` takes an injectable `spawnFn` (default = `node:child_process`.`spawn`); tests pass a fake child.
- **Never throw on malformed CLI output.** `parseEventLine` returns `[]` for unparseable/empty/unknown lines.
- **Phase 1 permission mode is `acceptEdits`** (auto-approves edits + safe FS ops; blocks Bash/network). UI permission prompts are Phase 3.
- Reuse `buildOpeningPrompt(plan, brief)` from `lib/armSession.ts` for the opening turn.
- Pure logic in `lib/liveSession/*.ts` with colocated `*.test.ts`; follow existing patterns.

---

### Task 1: Event parser (`parseEvents.ts`)

Pure mapping from `claude` stream-json stdout lines to normalized `SessionEvent`s, plus a buffering `StreamParser` for chunked stdout.

**Files:**

- Create: `lib/liveSession/parseEvents.ts`
- Test: `lib/liveSession/parseEvents.test.ts`

**Interfaces:**

- Produces:
  - `type SessionEvent` (union below).
  - `parseEventLine(line: string): SessionEvent[]` — 0..n events for one stdout line (an assistant message may carry both text and tool_use blocks). `[]` on empty/malformed/unknown.
  - `class StreamParser { push(chunk: string): SessionEvent[] }` — buffers partial lines across chunks, emits events for each completed line.

- [ ] **Step 1: Write the failing tests**

Create `lib/liveSession/parseEvents.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseEventLine, StreamParser, type SessionEvent } from './parseEvents';

const line = (o: unknown) => JSON.stringify(o);

describe('parseEventLine', () => {
  it('maps a system init line to an init event', () => {
    expect(parseEventLine(line({ type: 'system', subtype: 'init', session_id: 's1' }))).toEqual([
      { kind: 'init', sessionId: 's1' },
    ]);
  });

  it('maps an assistant message to text + tool-use events in order', () => {
    const raw = line({
      type: 'assistant',
      session_id: 's1',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Reading the file' },
          { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a.ts' } },
        ],
      },
    });
    expect(parseEventLine(raw)).toEqual([
      { kind: 'assistant-text', text: 'Reading the file' },
      { kind: 'tool-use', id: 't1', name: 'Read', input: { file_path: '/a.ts' } },
    ]);
  });

  it('maps a user tool_result message to a tool-result event', () => {
    const raw = line({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'file body', is_error: false },
        ],
      },
    });
    expect(parseEventLine(raw)).toEqual([
      { kind: 'tool-result', id: 't1', ok: true, summary: 'file body' },
    ]);
  });

  it('marks an errored tool result', () => {
    const raw = line({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't2', content: 'boom', is_error: true }],
      },
    });
    expect(parseEventLine(raw)).toEqual([
      { kind: 'tool-result', id: 't2', ok: false, summary: 'boom' },
    ]);
  });

  it('maps a result line to a result event', () => {
    const raw = line({ type: 'result', subtype: 'success', result: 'done', session_id: 's1' });
    expect(parseEventLine(raw)).toEqual([{ kind: 'result', text: 'done', sessionId: 's1' }]);
  });

  it('returns [] for empty, malformed, or unknown lines', () => {
    expect(parseEventLine('')).toEqual([]);
    expect(parseEventLine('   ')).toEqual([]);
    expect(parseEventLine('{not json')).toEqual([]);
    expect(parseEventLine(line({ type: 'whatever' }))).toEqual([]);
  });

  it('flattens tool_result content given as an array of blocks', () => {
    const raw = line({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't3',
            content: [{ type: 'text', text: 'part' }],
            is_error: false,
          },
        ],
      },
    });
    expect(parseEventLine(raw)).toEqual([
      { kind: 'tool-result', id: 't3', ok: true, summary: 'part' },
    ]);
  });
});

describe('StreamParser', () => {
  it('emits events only for completed newline-terminated lines', () => {
    const p = new StreamParser();
    const first = p.push(
      line({ type: 'system', subtype: 'init', session_id: 's1' }) + '\n' + '{"type":"assis',
    );
    expect(first).toEqual([{ kind: 'init', sessionId: 's1' }]);
    const rest = p.push(
      't","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}\n',
    );
    expect(rest).toEqual([{ kind: 'assistant-text', text: 'hi' }]);
  });

  it('ignores blank lines between events', () => {
    const p = new StreamParser();
    const evs = p.push(
      '\n\n' + line({ type: 'result', subtype: 'success', result: 'ok', session_id: 's' }) + '\n',
    );
    expect(evs).toEqual([{ kind: 'result', text: 'ok', sessionId: 's' }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/liveSession/parseEvents.test.ts`
Expected: FAIL — `Cannot find module './parseEvents'`.

- [ ] **Step 3: Write the implementation**

Create `lib/liveSession/parseEvents.ts`:

```ts
// Pure parser: turn `claude` stream-json stdout into normalized SessionEvents.
// The CLI emits one JSON object per line: {type:'system'|'assistant'|'user'|'result'}.
// An assistant line's message.content may hold several blocks (text + tool_use), so
// one line can yield several events. Never throws — unknown/malformed → [].
// See docs/superpowers/specs/2026-07-03-build-coach-inui-claude-session-design.md.

export type SessionEvent =
  | { kind: 'init'; sessionId: string }
  | { kind: 'assistant-text'; text: string }
  | { kind: 'tool-use'; id: string; name: string; input: unknown }
  | { kind: 'tool-result'; id: string; ok: boolean; summary: string }
  | { kind: 'result'; text: string; sessionId: string }
  | { kind: 'error'; message: string }
  | { kind: 'exit'; code: number | null };

/** Coerce tool_result `content` (string, or an array of text blocks) to a string. */
function resultSummary(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string'
          ? (b as { text: string }).text
          : '',
      )
      .join('')
      .trim();
  }
  return '';
}

export function parseEventLine(line: string): SessionEvent[] {
  const t = line.trim();
  if (!t) return [];
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(t);
  } catch {
    return [];
  }
  if (!obj || typeof obj !== 'object') return [];

  if (obj.type === 'system' && obj.subtype === 'init') {
    return [{ kind: 'init', sessionId: String(obj.session_id ?? '') }];
  }

  if (obj.type === 'result') {
    return [
      { kind: 'result', text: String(obj.result ?? ''), sessionId: String(obj.session_id ?? '') },
    ];
  }

  const msg = (obj.message ?? {}) as { content?: unknown };
  const content = Array.isArray(msg.content) ? msg.content : [];

  if (obj.type === 'assistant') {
    const out: SessionEvent[] = [];
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      const block = b as Record<string, unknown>;
      if (block.type === 'text' && typeof block.text === 'string') {
        out.push({ kind: 'assistant-text', text: block.text });
      } else if (block.type === 'tool_use') {
        out.push({
          kind: 'tool-use',
          id: String(block.id ?? ''),
          name: String(block.name ?? ''),
          input: block.input,
        });
      }
    }
    return out;
  }

  if (obj.type === 'user') {
    const out: SessionEvent[] = [];
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      const block = b as Record<string, unknown>;
      if (block.type === 'tool_result') {
        out.push({
          kind: 'tool-result',
          id: String(block.tool_use_id ?? ''),
          ok: block.is_error !== true,
          summary: resultSummary(block.content),
        });
      }
    }
    return out;
  }

  return [];
}

/** Buffers chunked stdout and emits events for each completed (\n-terminated) line. */
export class StreamParser {
  private buf = '';
  push(chunk: string): SessionEvent[] {
    this.buf += chunk;
    const out: SessionEvent[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      out.push(...parseEventLine(line));
    }
    return out;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/liveSession/parseEvents.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/liveSession/parseEvents.ts lib/liveSession/parseEvents.test.ts
git commit -m "feat(live-session): pure stream-json event parser"
```

---

### Task 2: Transcript reducer (`transcript.ts`)

Pure fold from `SessionEvent`s into the chat view model.

**Files:**

- Create: `lib/liveSession/transcript.ts`
- Test: `lib/liveSession/transcript.test.ts`

**Interfaces:**

- Consumes: `SessionEvent` (Task 1).
- Produces:
  - `interface ToolActivity { id: string; name: string; input: unknown; ok?: boolean; summary?: string }`
  - `interface TranscriptState { sessionId?: string; status: 'running' | 'ended' | 'error'; messages: Array<{ role: 'assistant'; text: string }>; tools: ToolActivity[]; actionCount: number; error?: string }`
  - `function initialTranscript(): TranscriptState`
  - `function reduceTranscript(state: TranscriptState, event: SessionEvent): TranscriptState` — pure, never mutates input.

- [ ] **Step 1: Write the failing tests**

Create `lib/liveSession/transcript.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { initialTranscript, reduceTranscript, type TranscriptState } from './transcript';
import type { SessionEvent } from './parseEvents';

const run = (events: SessionEvent[]): TranscriptState =>
  events.reduce(reduceTranscript, initialTranscript());

describe('reduceTranscript', () => {
  it('starts empty and running', () => {
    const s = initialTranscript();
    expect(s.status).toBe('running');
    expect(s.messages).toEqual([]);
    expect(s.tools).toEqual([]);
    expect(s.actionCount).toBe(0);
  });

  it('records the session id from init', () => {
    expect(run([{ kind: 'init', sessionId: 's1' }]).sessionId).toBe('s1');
  });

  it('appends assistant text as messages', () => {
    const s = run([
      { kind: 'assistant-text', text: 'hi' },
      { kind: 'assistant-text', text: 'again' },
    ]);
    expect(s.messages).toEqual([
      { role: 'assistant', text: 'hi' },
      { role: 'assistant', text: 'again' },
    ]);
  });

  it('adds a tool on tool-use and bumps actionCount', () => {
    const s = run([{ kind: 'tool-use', id: 't1', name: 'Read', input: { file_path: '/a' } }]);
    expect(s.tools).toEqual([{ id: 't1', name: 'Read', input: { file_path: '/a' } }]);
    expect(s.actionCount).toBe(1);
  });

  it('attaches a matching tool-result to its tool without adding an action', () => {
    const s = run([
      { kind: 'tool-use', id: 't1', name: 'Read', input: {} },
      { kind: 'tool-result', id: 't1', ok: true, summary: 'body' },
    ]);
    expect(s.tools).toEqual([{ id: 't1', name: 'Read', input: {}, ok: true, summary: 'body' }]);
    expect(s.actionCount).toBe(1);
  });

  it('ends on result and error on error/exit', () => {
    expect(run([{ kind: 'result', text: 'done', sessionId: 's' }]).status).toBe('ended');
    expect(run([{ kind: 'error', message: 'boom' }]).status).toBe('error');
    const ex = run([{ kind: 'exit', code: 1 }]);
    expect(ex.status).toBe('error');
    const ok = run([
      { kind: 'result', text: 'd', sessionId: 's' },
      { kind: 'exit', code: 0 },
    ]);
    expect(ok.status).toBe('ended'); // a clean exit after result stays ended
  });

  it('does not mutate the input state', () => {
    const s0 = initialTranscript();
    reduceTranscript(s0, { kind: 'assistant-text', text: 'x' });
    expect(s0.messages).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/liveSession/transcript.test.ts`
Expected: FAIL — `Cannot find module './transcript'`.

- [ ] **Step 3: Write the implementation**

Create `lib/liveSession/transcript.ts`:

```ts
// Pure reducer: fold SessionEvents into the chat view model the DuringStep renders.
// Never mutates its input. actionCount = number of tool invocations (feeds Byte's
// budget meter). See the in-UI Claude session design spec.
import type { SessionEvent } from './parseEvents';

export interface ToolActivity {
  id: string;
  name: string;
  input: unknown;
  ok?: boolean;
  summary?: string;
}

export interface TranscriptState {
  sessionId?: string;
  status: 'running' | 'ended' | 'error';
  messages: Array<{ role: 'assistant'; text: string }>;
  tools: ToolActivity[];
  actionCount: number;
  error?: string;
}

export function initialTranscript(): TranscriptState {
  return { status: 'running', messages: [], tools: [], actionCount: 0 };
}

export function reduceTranscript(state: TranscriptState, event: SessionEvent): TranscriptState {
  switch (event.kind) {
    case 'init':
      return { ...state, sessionId: event.sessionId };
    case 'assistant-text':
      return { ...state, messages: [...state.messages, { role: 'assistant', text: event.text }] };
    case 'tool-use':
      return {
        ...state,
        tools: [...state.tools, { id: event.id, name: event.name, input: event.input }],
        actionCount: state.actionCount + 1,
      };
    case 'tool-result':
      return {
        ...state,
        tools: state.tools.map((t) =>
          t.id === event.id ? { ...t, ok: event.ok, summary: event.summary } : t,
        ),
      };
    case 'result':
      return { ...state, sessionId: event.sessionId || state.sessionId, status: 'ended' };
    case 'error':
      return { ...state, status: 'error', error: event.message };
    case 'exit':
      // A non-zero exit, or an exit before a result, is a failure; a clean exit
      // after we already ended stays ended.
      if (state.status === 'ended') return state;
      return event.code === 0
        ? { ...state, status: 'ended' }
        : { ...state, status: 'error', error: `claude exited with code ${event.code}` };
    default:
      return state;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/liveSession/transcript.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/liveSession/transcript.ts lib/liveSession/transcript.test.ts
git commit -m "feat(live-session): pure transcript reducer"
```

---

### Task 3: Session engine + registry (`engine.ts`, `registry.ts`)

Spawn and manage the `claude` child, pipe stdout through the parser onto a per-session emitter. Unit-tested with an injected fake spawn.

**Files:**

- Create: `lib/liveSession/registry.ts`
- Create: `lib/liveSession/engine.ts`
- Test: `lib/liveSession/engine.test.ts`

**Interfaces:**

- Consumes: `StreamParser`, `SessionEvent` (Task 1); `buildOpeningPrompt` from `lib/armSession.ts`.
- Produces:
  - `registry.ts`: `interface LiveSession { emitter: EventEmitter; child: { stdin: NodeJS.WritableStream; kill: () => void }; status: 'running' | 'ended' | 'error'; buffer: SessionEvent[] }`, plus `getSession(id)`, `setSession(id, s)`, `deleteSession(id)`.
  - `engine.ts`:
    - `type SpawnFn = (cmd: string, args: string[], opts: { cwd: string }) => ChildLike` where `ChildLike = { stdout: EventEmitter; stderr: EventEmitter; stdin: { write: (s: string) => void; end: () => void }; on: (ev: string, cb: (arg?: unknown) => void) => void; kill: () => void }`.
    - `function startSession(opts: { buildSessionId: string; projectDir: string; openingPrompt: string; spawnFn?: SpawnFn }): void`
    - `function stopSession(buildSessionId: string): void`
    - `CLAUDE_ARGS: string[]` (exported for the test to assert).

- [ ] **Step 1: Write the failing test**

Create `lib/liveSession/engine.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { startSession, stopSession, CLAUDE_ARGS } from './engine';
import { getSession } from './registry';
import type { SessionEvent } from './parseEvents';

// A fake `claude` child: stdout/stderr are EventEmitters, stdin records writes.
function fakeChild() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { writes: string[]; ended: boolean; write(s: string): void; end(): void };
    kill(): void;
    killed: boolean;
  };
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.killed = false;
  proc.stdin = {
    writes: [],
    ended: false,
    write(s: string) {
      this.writes.push(s);
    },
    end() {
      this.ended = true;
    },
  };
  proc.kill = () => {
    proc.killed = true;
  };
  return proc;
}

describe('startSession', () => {
  it('spawns claude with the streaming args in the project dir and writes the opening prompt', () => {
    const child = fakeChild();
    const spawnFn = vi.fn(() => child) as never;
    startSession({ buildSessionId: 'b1', projectDir: '/proj', openingPrompt: 'build X', spawnFn });

    expect(spawnFn).toHaveBeenCalledWith('claude', CLAUDE_ARGS, { cwd: '/proj' });
    // opening prompt written as a stream-json user message, then stdin closed (P1 one-shot).
    expect(child.stdin.writes.length).toBe(1);
    const sent = JSON.parse(child.stdin.writes[0]);
    expect(sent).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'build X' }] },
    });
    expect(child.stdin.ended).toBe(true);
  });

  it('parses stdout into events on the session emitter and buffers them', () => {
    const child = fakeChild();
    const events: SessionEvent[] = [];
    startSession({
      buildSessionId: 'b2',
      projectDir: '/p',
      openingPrompt: 'x',
      spawnFn: (() => child) as never,
    });
    getSession('b2')!.emitter.on('event', (e: SessionEvent) => events.push(e));

    child.stdout.emit(
      'data',
      Buffer.from(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's9' }) + '\n'),
    );
    child.stdout.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'hey' }] },
        }) + '\n',
      ),
    );

    expect(events).toEqual([
      { kind: 'init', sessionId: 's9' },
      { kind: 'assistant-text', text: 'hey' },
    ]);
    expect(getSession('b2')!.buffer).toEqual(events);
  });

  it('emits an exit event and marks the session ended when the child closes', () => {
    const child = fakeChild();
    const events: SessionEvent[] = [];
    startSession({
      buildSessionId: 'b3',
      projectDir: '/p',
      openingPrompt: 'x',
      spawnFn: (() => child) as never,
    });
    getSession('b3')!.emitter.on('event', (e: SessionEvent) => events.push(e));
    child.emit('close', 0);
    expect(events).toContainEqual({ kind: 'exit', code: 0 });
  });

  it('stopSession kills the child and deletes the registry entry', () => {
    const child = fakeChild();
    startSession({
      buildSessionId: 'b4',
      projectDir: '/p',
      openingPrompt: 'x',
      spawnFn: (() => child) as never,
    });
    stopSession('b4');
    expect(child.killed).toBe(true);
    expect(getSession('b4')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/liveSession/engine.test.ts`
Expected: FAIL — `Cannot find module './engine'`.

- [ ] **Step 3: Write `registry.ts`**

Create `lib/liveSession/registry.ts`:

```ts
// Module-level registry of live `claude` sessions, keyed by buildSessionId. Holds
// the child handle, an event emitter the stream route subscribes to, a replay
// buffer (so a (re)connecting stream sees prior events), and status. Single-user
// local scope — intentionally in-memory and not persisted.
import type { EventEmitter } from 'node:events';
import type { SessionEvent } from './parseEvents';

export interface LiveSession {
  emitter: EventEmitter;
  child: { stdin: { write(s: string): void; end(): void }; kill(): void };
  status: 'running' | 'ended' | 'error';
  buffer: SessionEvent[];
}

const sessions = new Map<string, LiveSession>();

export function getSession(id: string): LiveSession | undefined {
  return sessions.get(id);
}
export function setSession(id: string, s: LiveSession): void {
  sessions.set(id, s);
}
export function deleteSession(id: string): void {
  sessions.delete(id);
}
```

- [ ] **Step 4: Write `engine.ts`**

Create `lib/liveSession/engine.ts`:

```ts
// Spawns and manages the real `claude` CLI headless for a build session. Pipes its
// stream-json stdout through the pure parser onto a per-session emitter, buffering
// events for replay. Phase 1 is one-shot: write the opening prompt, close stdin, let
// claude run the turn and exit. `spawnFn` is injectable so this is unit-tested with a
// fake child (no real binary). See the in-UI Claude session design spec.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { StreamParser, type SessionEvent } from './parseEvents';
import { getSession, setSession, deleteSession, type LiveSession } from './registry';

/** Headless streaming args. `acceptEdits` is the Phase 1 permission mode (UI
 *  permission prompts arrive in Phase 3). */
export const CLAUDE_ARGS = [
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--permission-mode',
  'acceptEdits',
];

interface ChildLike {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write(s: string): void; end(): void };
  on(event: string, cb: (arg?: unknown) => void): void;
  kill(): void;
}
export type SpawnFn = (cmd: string, args: string[], opts: { cwd: string }) => ChildLike;

const defaultSpawn: SpawnFn = (cmd, args, opts) =>
  spawn(cmd, args, { cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] }) as unknown as ChildLike;

/** One user turn, encoded as a stream-json input line. */
function userLine(text: string): string {
  return (
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) +
    '\n'
  );
}

export function startSession(opts: {
  buildSessionId: string;
  projectDir: string;
  openingPrompt: string;
  spawnFn?: SpawnFn;
}): void {
  const spawnFn = opts.spawnFn ?? defaultSpawn;
  const child = spawnFn('claude', CLAUDE_ARGS, { cwd: opts.projectDir });
  const emitter = new EventEmitter();
  const session: LiveSession = { emitter, child, status: 'running', buffer: [] };
  setSession(opts.buildSessionId, session);

  const emit = (e: SessionEvent) => {
    session.buffer.push(e);
    if (e.kind === 'result') session.status = 'ended';
    if (e.kind === 'error' || (e.kind === 'exit' && e.code !== 0)) session.status = 'error';
    emitter.emit('event', e);
  };

  const parser = new StreamParser();
  child.stdout.on('data', (chunk: Buffer) => {
    for (const e of parser.push(chunk.toString('utf8'))) emit(e);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    const msg = chunk.toString('utf8').trim();
    if (msg) emit({ kind: 'error', message: msg });
  });
  child.on('error', (err) =>
    emit({ kind: 'error', message: err instanceof Error ? err.message : String(err) }),
  );
  child.on('close', (code) => emit({ kind: 'exit', code: typeof code === 'number' ? code : null }));

  // Phase 1: single turn — send the opening prompt then close stdin so claude runs
  // and exits. Phase 2 keeps stdin open for follow-ups.
  child.stdin.write(userLine(opts.openingPrompt));
  child.stdin.end();
}

export function stopSession(buildSessionId: string): void {
  const s = getSession(buildSessionId);
  if (!s) return;
  try {
    s.child.kill();
  } catch {
    // already gone
  }
  deleteSession(buildSessionId);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/liveSession/engine.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck` → clean.

```bash
git add lib/liveSession/registry.ts lib/liveSession/engine.ts lib/liveSession/engine.test.ts
git commit -m "feat(live-session): claude child engine + session registry"
```

---

### Task 4: API routes (`/start`, `/stream`)

Local-only HTTP surface: start a session, then stream its events to the browser.

**Files:**

- Create: `app/api/build-session/start/route.ts`
- Create: `app/api/build-session/stream/route.ts`
- Test: `app/api/build-session/start/route.test.ts`

**Interfaces:**

- Consumes: `startSession`, `stopSession` (Task 3); `getSession` (Task 3); `buildOpeningPrompt` (`lib/armSession.ts`); `detectCapability` (`lib/installer/capability.mjs`); `BytePlan` (`lib/ai/plan`).
- Produces: `POST /api/build-session/start` → `{ ok: true } | { ok: false; reason: 'remote' | 'bad_request' }`; `GET /api/build-session/stream?buildSessionId=…` → `application/x-ndjson` stream.

- [ ] **Step 1: Write the failing test (start route, remote + local branches)**

Create `app/api/build-session/start/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const startSession = vi.fn();
vi.mock('@/lib/liveSession/engine', () => ({ startSession, stopSession: vi.fn() }));

const detectCapability = vi.fn();
vi.mock('@/lib/installer/capability.mjs', () => ({ detectCapability }));

import { POST } from './route';

const plan = { title: 'T', steps: ['a'], budgetActions: 8 };
const body = (b: unknown) =>
  new Request('http://localhost/api/build-session/start', {
    method: 'POST',
    body: JSON.stringify(b),
  });

beforeEach(() => {
  startSession.mockClear();
  detectCapability.mockReset();
});

describe('POST /api/build-session/start', () => {
  it('refuses in remote mode without spawning', async () => {
    detectCapability.mockReturnValue({ mode: 'remote' });
    const res = await POST(body({ buildSessionId: 'b1', projectDir: '/p', plan, brief: 'x' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, reason: 'remote' });
    expect(startSession).not.toHaveBeenCalled();
  });

  it('starts a session in local mode', async () => {
    detectCapability.mockReturnValue({ mode: 'local' });
    const res = await POST(body({ buildSessionId: 'b1', projectDir: '/p', plan, brief: 'do it' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(startSession).toHaveBeenCalledTimes(1);
    const arg = startSession.mock.calls[0][0];
    expect(arg.buildSessionId).toBe('b1');
    expect(arg.projectDir).toBe('/p');
    expect(typeof arg.openingPrompt).toBe('string');
    expect(arg.openingPrompt).toContain('do it');
  });

  it('rejects a bad body in local mode', async () => {
    detectCapability.mockReturnValue({ mode: 'local' });
    const res = await POST(body({ buildSessionId: '', projectDir: '', plan: null, brief: '' }));
    expect(res.status).toBe(400);
    expect(startSession).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/build-session/start/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write the start route**

Create `app/api/build-session/start/route.ts`:

```ts
// Start a live in-UI Claude Code session (local mode only). Spawns the real `claude`
// in the chosen project with the plan's opening prompt; the browser then opens
// /api/build-session/stream to watch it. See the in-UI Claude session design spec.
import { NextResponse } from 'next/server';
import { startSession } from '@/lib/liveSession/engine';
import { buildOpeningPrompt } from '@/lib/armSession';
import { detectCapability } from '@/lib/installer/capability.mjs';
import type { BytePlan } from '@/lib/ai/plan';

export const runtime = 'nodejs';

interface StartBody {
  buildSessionId?: string;
  projectDir?: string;
  plan?: BytePlan;
  brief?: string;
}

export async function POST(req: Request): Promise<Response> {
  if (detectCapability(process.env).mode !== 'local') {
    return NextResponse.json({ ok: false, reason: 'remote' }, { status: 409 });
  }
  let body: StartBody;
  try {
    body = (await req.json()) as StartBody;
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  }
  const { buildSessionId, projectDir, plan, brief } = body;
  if (!buildSessionId || !projectDir || !plan || typeof plan !== 'object' || !brief) {
    return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  }
  startSession({
    buildSessionId,
    projectDir,
    openingPrompt: buildOpeningPrompt(plan, brief),
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Write the stream route**

Create `app/api/build-session/stream/route.ts`:

```ts
// Long-lived stream of a live session's events to the browser as newline-delimited
// JSON (same transport style as /api/chat). Replays the buffered events on connect
// so a (re)connection resumes, then forwards new events until the session ends.
import { getSession } from '@/lib/liveSession/registry';
import type { SessionEvent } from '@/lib/liveSession/parseEvents';

export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get('buildSessionId') ?? '';
  const session = getSession(id);
  if (!session) {
    return new Response(JSON.stringify({ error: 'no such session' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (e: SessionEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(e) + '\n'));
      // Replay what already happened.
      for (const e of session.buffer) send(e);
      if (session.status !== 'running') {
        controller.close();
        return;
      }
      const onEvent = (e: SessionEvent) => {
        send(e);
        if (e.kind === 'result' || e.kind === 'exit' || e.kind === 'error') {
          session.emitter.off('event', onEvent);
          controller.close();
        }
      };
      session.emitter.on('event', onEvent);
    },
  });

  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' },
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run app/api/build-session/start/route.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck` → clean.

```bash
git add app/api/build-session/
git commit -m "feat(live-session): /start and /stream routes (local-only)"
```

---

### Task 5: Wire the DURING step to the live chat (local mode)

Replace the DURING body with a chat transcript fed by the stream, in local mode; keep the existing meter/Terminal path as the remote fallback.

**Files:**

- Create: `lib/liveSession/useLiveSession.ts` (client hook: start + read stream → transcript state)
- Create: `components/views/build/LiveChat.tsx` (the transcript UI)
- Modify: `components/views/BuildCoachView.tsx` (`DuringStep` renders `LiveChat` in local mode)
- Test: `lib/liveSession/transcriptFromLines.test.ts` (pure helper the hook uses)

**Interfaces:**

- Consumes: `reduceTranscript`, `initialTranscript`, `TranscriptState` (Task 2); `parseEventLine` (Task 1); `/api/build-session/start` + `/stream` (Task 4).
- Produces: `applyLine(state, line): TranscriptState` (pure, testable); `useLiveSession({ buildSessionId, projectDir, plan, brief })` returning `{ state, start }`.

- [ ] **Step 1: Write the failing test for the pure line-applier**

Create `lib/liveSession/transcriptFromLines.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { applyLine } from './useLiveSession';
import { initialTranscript } from './transcript';

describe('applyLine', () => {
  it('folds a raw ndjson line (possibly yielding several events) into the transcript', () => {
    let s = initialTranscript();
    s = applyLine(s, JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }));
    s = applyLine(
      s,
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'hi' },
            { type: 'tool_use', id: 't1', name: 'Read', input: {} },
          ],
        },
      }),
    );
    expect(s.sessionId).toBe('s1');
    expect(s.messages).toEqual([{ role: 'assistant', text: 'hi' }]);
    expect(s.tools.map((t) => t.name)).toEqual(['Read']);
    expect(s.actionCount).toBe(1);
  });

  it('ignores a blank or malformed line', () => {
    const s0 = initialTranscript();
    expect(applyLine(s0, '')).toBe(s0);
    expect(applyLine(s0, '{bad')).toBe(s0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/liveSession/transcriptFromLines.test.ts`
Expected: FAIL — `Cannot find module './useLiveSession'`.

- [ ] **Step 3: Write the client hook**

Create `lib/liveSession/useLiveSession.ts`:

```ts
'use client';
import { useCallback, useRef, useState } from 'react';
import { initialTranscript, reduceTranscript, type TranscriptState } from './transcript';
import { parseEventLine } from './parseEvents';
import type { BytePlan } from '../ai/plan';

/** Pure: fold one raw ndjson stream line (0..n events) into the transcript.
 *  Returns the same reference when the line yields nothing (blank/malformed). */
export function applyLine(state: TranscriptState, line: string): TranscriptState {
  const events = parseEventLine(line);
  if (events.length === 0) return state;
  return events.reduce(reduceTranscript, state);
}

export function useLiveSession(opts: {
  buildSessionId: string;
  projectDir: string;
  plan: BytePlan;
  brief: string;
}) {
  const [state, setState] = useState<TranscriptState>(initialTranscript);
  const started = useRef(false);

  const start = useCallback(async () => {
    if (started.current) return;
    started.current = true;
    const res = await fetch('/api/build-session/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(opts),
    });
    if (!res.ok) {
      setState((s) =>
        reduceTranscript(s, { kind: 'error', message: 'Could not start the session here.' }),
      );
      return;
    }
    const stream = await fetch(
      `/api/build-session/stream?buildSessionId=${encodeURIComponent(opts.buildSessionId)}`,
    );
    if (!stream.ok || !stream.body) return;
    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        setState((s) => applyLine(s, line));
      }
    }
  }, [opts]);

  return { state, start };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/liveSession/transcriptFromLines.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the transcript UI**

Create `components/views/build/LiveChat.tsx`:

```tsx
'use client';
import { useEffect } from 'react';
import { useLiveSession } from '@/lib/liveSession/useLiveSession';
import type { BytePlan } from '@/lib/ai/plan';

// Phase 1: read-only live transcript of the real `claude` session — assistant text
// and tool activity, streamed into the UI. Composer + permission prompts are later
// phases. See the in-UI Claude session design spec.
export function LiveChat({
  buildSessionId,
  projectDir,
  plan,
  brief,
}: {
  buildSessionId: string;
  projectDir: string;
  plan: BytePlan;
  brief: string;
}) {
  const { state, start } = useLiveSession({ buildSessionId, projectDir, plan, brief });

  useEffect(() => {
    start();
  }, [start]);

  return (
    <div className="lc-wrap">
      <div className="lc-feed">
        {state.messages.map((m, i) => (
          <div key={`m${i}`} className="lc-msg">
            {m.text}
          </div>
        ))}
        {state.tools.map((t) => (
          <div key={t.id} className={`lc-tool${t.ok === false ? ' err' : ''}`}>
            <b>{t.name}</b>
            {t.summary ? <span className="lc-tool-sum"> — {t.summary.slice(0, 120)}</span> : null}
          </div>
        ))}
        {state.status === 'error' && (
          <div className="lc-err">{state.error ?? 'Something went wrong.'}</div>
        )}
        {state.status === 'ended' && <div className="lc-done">Session finished.</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Render `LiveChat` from `DuringStep` in local mode**

In `components/views/BuildCoachView.tsx`, the `DuringStep` currently shows the meter and (in local) has already armed a Terminal. For Phase 1 we render the live chat when the session was started in local mode. Add the import at the top of the file:

```tsx
import { LiveChat } from './build/LiveChat';
```

Then in `DuringStep`, add a prop `local: boolean` and, when `local` is true and we have `projectDir`+`plan`+`brief`, render `<LiveChat ... />` above the existing meter. Concretely, change the `DuringStep` signature and body. Add to its props type:

```tsx
  local,
  projectDir,
  brief,
}: {
  plan: BytePlan | null;
  live: LiveState | null;
  unlocked: boolean;
  launchCommand: string | null;
  local: boolean;
  projectDir: string;
  brief: string;
}) {
```

And immediately after `<div className="bc-panel-h">Step 2 · building now</div>` insert:

```tsx
{
  local && plan && projectDir && brief && (
    <LiveChat
      buildSessionId={/* passed via prop below */ ''}
      projectDir={projectDir}
      plan={plan}
      brief={brief}
    />
  );
}
```

Then pass the new props where `DuringStep` is rendered (in `BuildCoachView`'s return): add `local`, `projectDir`, `brief`, and a `buildSessionId`. To keep the buildSessionId consistent, lift it: `LiveChat`'s `buildSessionId` must equal the `buildSessionId` state already in `BuildCoachView`. Update the `LiveChat` usage to take it as a prop from `DuringStep` (thread `buildSessionId` through `DuringStep` props too).

> Implementer note: `BuildCoachView` already holds `buildSessionId`, `project`, `plan`, `brief`, and computes `dirs`/`projectDir` inside `startBuild`. Lift `projectDir` into state (set it in `startBuild` alongside `setBuildSessionId`) and pass `local` = `useAuth`/capability (there is no client capability yet — derive `local` from whether `armBuildSession` returned `launched` OR a new `/api/build-session/start` succeeded). For Phase 1, drive the whole DURING off `/api/build-session/start` in local mode instead of `armBuildSession`; keep `armBuildSession` only for the remote fallback. Wire `buildSessionId`, `projectDir`, `plan`, `brief`, `local` through to `DuringStep` → `LiveChat`.

- [ ] **Step 7: Add minimal styles**

In `app/globals.css`, append:

```css
.lc-wrap {
  margin: 8px 0 14px;
}
.lc-feed {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 340px;
  overflow-y: auto;
  padding: 10px;
  background: var(--panel, #faf7ff);
  border-radius: 12px;
}
.lc-msg {
  white-space: pre-wrap;
  line-height: 1.4;
}
.lc-tool {
  font-size: 13px;
  opacity: 0.8;
}
.lc-tool.err {
  color: #c0392b;
}
.lc-tool-sum {
  opacity: 0.7;
}
.lc-err {
  color: #c0392b;
}
.lc-done {
  opacity: 0.6;
  font-size: 13px;
}
```

- [ ] **Step 8: Typecheck + manual smoke + commit**

Run: `npm run typecheck` → clean.
Manual (needs local `claude`): `npm run dev`, open Let's build, generate a plan, pick a project dir, click Start — confirm assistant text + tool activity stream into the transcript and it ends cleanly.

```bash
git add lib/liveSession/useLiveSession.ts lib/liveSession/transcriptFromLines.test.ts components/views/build/LiveChat.tsx components/views/BuildCoachView.tsx app/globals.css
git commit -m "feat(live-session): DURING step renders the live claude transcript (local)"
```

---

### Task 6: Verification

**Files:** none.

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: PASS (all vitest suites incl. `liveSession/*`).

- [ ] **Step 2: Installer suite**

Run: `npm run test:installer`
Expected: PASS.

- [ ] **Step 3: Typecheck + lint + format**

Run: `npm run typecheck && npm run lint && npm run format:check`
Expected: no type errors; 0 lint errors; format clean on tracked files.

- [ ] **Step 4: End-to-end (real session)**

`npm run dev` → Let's build → plan → pick a real repo → Start → confirm the transcript streams Claude's text + tools live and finishes. Try a project where Claude edits a file (allowed under `acceptEdits`) and one where it wants Bash (blocked — should surface as a tool error, since P1 has no UI prompt yet).

---

## Self-Review

**Spec coverage (Phase 1 scope):**

- Type a brief + pick project → run real local `claude`, stream into transcript → Tasks 3,4,5. ✓
- Local-mode-only guard → Task 4 (`detectCapability`). ✓
- Streaming transport = ndjson ReadableStream → Task 4 `/stream`. ✓
- Child persists via registry → Task 3. ✓
- Engine unit-testable via injected spawn → Task 3. ✓
- Never throw on malformed output → Task 1 (`parseEventLine` → `[]`). ✓
- `acceptEdits` interim permission mode → Task 3 (`CLAUDE_ARGS`). ✓
- Reuse `buildOpeningPrompt` → Task 4. ✓
- START/END unchanged; meter kept as remote fallback → Task 5 note. ✓
- (Phase 2 two-way input and Phase 3 UI permissions are explicitly out of this plan.)

**Placeholder scan:** Task 5 Step 6 is the one prose-heavy wiring step; it names exact props/functions and the concrete change, not "TODO". All code steps carry complete code. No "handle edge cases"/"add validation" placeholders.

**Type consistency:** `SessionEvent` union identical across Tasks 1/2/3/5; `TranscriptState`/`ToolActivity` consistent Tasks 2/5; `startSession(opts)` shape consistent Tasks 3/4; `CLAUDE_ARGS` exported (Task 3) and asserted (Task 3 test); `applyLine`/`useLiveSession` consistent Task 5; route contracts (`{ ok, reason }`) consistent Tasks 4/5.
