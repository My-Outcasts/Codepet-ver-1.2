# In-UI Claude Code session — Phase 2 (two-way chat) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the in-UI Claude Code session two-way — keep the `claude` process alive across turns so the user can type follow-up messages from the DURING step and the conversation continues.

**Architecture:** Phase 1 was one-shot (write opening prompt → close stdin → claude runs one turn and exits). Phase 2 keeps stdin OPEN: each turn ends with a `result` event meaning "this turn is done, awaiting your next message" (new `awaiting-input` status) rather than "session ended". A new `POST /api/build-session/send` writes a follow-up user turn to the live child's stdin; the stream stays open across turns (only closes on `exit`/`error`); the UI gains a composer and shows the user's own turns as chat bubbles.

**Tech Stack:** Next.js 16 (App Router, `runtime = 'nodejs'`), React 19, TypeScript, `node:child_process`, Vitest.

## Global Constraints

- **Local mode only.** The `/send` route rejects non-local like `/start` (via `detectCapability(process.env).mode`).
- **The child process now PERSISTS across turns** — `startSession` must NOT close stdin; the session ends only on `stopSession`, child exit, or error.
- **`result` = turn complete, session still alive** (`awaiting-input`), NOT session-ended. Session `status: 'ended'` now comes only from a clean child exit; `error`/non-zero exit → `error`.
- **The stream stays open across turns** — the `/stream` route closes only on `exit`/`error`, never on `result`.
- Pure logic (`transcript.ts`, `parseEvents.ts`) stays framework-free with colocated Vitest tests; never throws on bad input.
- English UI copy; follow existing patterns.
- This supersedes Phase 1's one-shot lifecycle and its `result`→ended / exit-before-result→error reducer tests — those are intentionally rewritten here.

---

### Task 1: Transcript & event model for multi-turn (`transcript.ts`, `parseEvents.ts`)

Widen the view model for two-way chat: user turns as messages, an `awaiting-input` status, and `result` meaning "turn done".

**Files:**

- Modify: `lib/liveSession/parseEvents.ts` (add `user-text` to the `SessionEvent` union)
- Modify: `lib/liveSession/transcript.ts`
- Test: `lib/liveSession/transcript.test.ts` (rewrite the lifecycle cases)

**Interfaces:**

- Consumes: `SessionEvent` (Phase 1).
- Produces:
  - `SessionEvent` gains `| { kind: 'user-text'; text: string }` (injected client-side on send; never emitted by the parser).
  - `TranscriptState.status` gains `'awaiting-input'`.
  - `TranscriptState.messages` role widens to `'user' | 'assistant'`.
  - `reduceTranscript`: `user-text` → append user message + status `running`; `result` → status `awaiting-input`; `exit` code 0 → `ended`, non-zero → `error` (keep an existing error); `error` → `error`.

- [ ] **Step 1: Rewrite the failing lifecycle tests**

In `lib/liveSession/transcript.test.ts`, REPLACE the existing `it('ends on result and error on error/exit', ...)`, `it('treats a clean exit before any result as an error', ...)`, and `it('keeps an existing error when a clean exit follows', ...)` tests with the multi-turn semantics, and ADD user-turn + awaiting-input cases:

```ts
it('a result means the turn is done and the session awaits input', () => {
  const s = run([{ kind: 'result', text: 'done', sessionId: 's' }]);
  expect(s.status).toBe('awaiting-input');
});

it('a user-text turn appends a user message and returns to running', () => {
  const s = run([
    { kind: 'result', text: 'done', sessionId: 's' },
    { kind: 'user-text', text: 'now add tests' },
  ]);
  expect(s.messages).toEqual([{ role: 'user', text: 'now add tests' }]);
  expect(s.status).toBe('running');
});

it('a clean exit ends the session; a non-zero exit errors', () => {
  expect(run([{ kind: 'exit', code: 0 }]).status).toBe('ended');
  expect(run([{ kind: 'exit', code: 1 }]).status).toBe('error');
});

it('error stands, and a later clean exit does not overwrite it', () => {
  const s = run([
    { kind: 'error', message: 'boom' },
    { kind: 'exit', code: 0 },
  ]);
  expect(s.status).toBe('error');
  expect(s.error).toBe('boom');
});

it('interleaves user and assistant messages in order', () => {
  const s = run([
    { kind: 'assistant-text', text: 'hi' },
    { kind: 'result', text: '', sessionId: 's' },
    { kind: 'user-text', text: 'more please' },
    { kind: 'assistant-text', text: 'ok' },
  ]);
  expect(s.messages).toEqual([
    { role: 'assistant', text: 'hi' },
    { role: 'user', text: 'more please' },
    { role: 'assistant', text: 'ok' },
  ]);
});
```

Keep the existing `init`/`assistant-text`/`tool-use`/`tool-result`/immutability tests unchanged.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/liveSession/transcript.test.ts`
Expected: FAIL — `result` currently sets `ended`; `user-text` unhandled; `exit code 0` before result currently errors.

- [ ] **Step 3: Add `user-text` to the SessionEvent union**

In `lib/liveSession/parseEvents.ts`, add a member to the `SessionEvent` union (after `assistant-text`):

```ts
  | { kind: 'user-text'; text: string }
```

(The parser never emits this — it is injected client-side when the user sends a turn — but the reducer must handle it, so it belongs in the shared union.)

- [ ] **Step 4: Update the reducer & types in `transcript.ts`**

In `lib/liveSession/transcript.ts`:

Change the `TranscriptState` interface:

```ts
export interface TranscriptState {
  sessionId?: string;
  status: 'running' | 'awaiting-input' | 'ended' | 'error';
  messages: Array<{ role: 'user' | 'assistant'; text: string }>;
  tools: ToolActivity[];
  actionCount: number;
  error?: string;
}
```

Replace the `assistant-text`, `result`, and `exit` cases, and add a `user-text` case:

```ts
    case 'assistant-text':
      return {
        ...state,
        status: 'running',
        messages: [...state.messages, { role: 'assistant', text: event.text }],
      };
    case 'user-text':
      return {
        ...state,
        status: 'running',
        messages: [...state.messages, { role: 'user', text: event.text }],
      };
```

```ts
    case 'result':
      // A turn finished — the session stays alive, waiting for the next user turn.
      return { ...state, sessionId: event.sessionId || state.sessionId, status: 'awaiting-input' };
    case 'error':
      return { ...state, status: 'error', error: event.message };
    case 'exit':
      // The process is gone. A clean exit ends the session; anything else is an
      // error. Never overwrite an error we already recorded.
      if (state.status === 'error') return state;
      return event.code === 0
        ? { ...state, status: 'ended' }
        : { ...state, status: 'error', error: state.error ?? `claude exited with code ${event.code}` };
```

Leave `init`, `tool-use`, `tool-result`, and `default` unchanged.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/liveSession/transcript.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck` → clean.

```bash
git add lib/liveSession/parseEvents.ts lib/liveSession/transcript.ts lib/liveSession/transcript.test.ts
git commit -m "feat(live-session): multi-turn transcript model (awaiting-input + user turns)"
```

---

### Task 2: Keep the child alive + send follow-up turns (`engine.ts`, `registry.ts`)

Stop closing stdin; add `sendTurn`; make `result` NOT terminate the server-side session.

**Files:**

- Modify: `lib/liveSession/engine.ts`
- Test: `lib/liveSession/engine.test.ts`

**Interfaces:**

- Consumes: `userLine` (existing, private in engine.ts); `getSession` (registry).
- Produces:
  - `startSession` no longer calls `child.stdin.end()` (stdin stays open).
  - `emit` no longer sets `session.status = 'ended'` on `result` (only `error`/non-zero `exit` change server status).
  - `function sendTurn(buildSessionId: string, text: string): boolean` — writes a user-turn line to the live child's stdin; returns `false` (no-op) if the session is missing or not running.

- [ ] **Step 1: Write the failing tests**

Add to `lib/liveSession/engine.test.ts` (the fake child from Phase 1 already records `stdin.writes` and `stdin.ended`):

```ts
import { startSession, stopSession, sendTurn, CLAUDE_ARGS } from './engine';

describe('two-way session', () => {
  it('startSession keeps stdin open (does not end it)', () => {
    const child = fakeChild();
    startSession({
      buildSessionId: 'tw1',
      projectDir: '/p',
      openingPrompt: 'x',
      spawnFn: (() => child) as never,
    });
    expect(child.stdin.writes.length).toBe(1); // opening prompt
    expect(child.stdin.ended).toBe(false); // stays open for follow-ups
  });

  it('a result event does not mark the session ended (still awaiting input)', () => {
    const child = fakeChild();
    startSession({
      buildSessionId: 'tw2',
      projectDir: '/p',
      openingPrompt: 'x',
      spawnFn: (() => child) as never,
    });
    child.stdout.emit(
      'data',
      Buffer.from(
        JSON.stringify({ type: 'result', subtype: 'success', result: 'done', session_id: 's' }) +
          '\n',
      ),
    );
    expect(getSession('tw2')!.status).toBe('running');
  });

  it('sendTurn writes a user-turn line to stdin and returns true', () => {
    const child = fakeChild();
    startSession({
      buildSessionId: 'tw3',
      projectDir: '/p',
      openingPrompt: 'x',
      spawnFn: (() => child) as never,
    });
    const ok = sendTurn('tw3', 'now write tests');
    expect(ok).toBe(true);
    const sent = JSON.parse(child.stdin.writes[1]);
    expect(sent).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'now write tests' }] },
    });
  });

  it('sendTurn on a missing session returns false', () => {
    expect(sendTurn('nope', 'hi')).toBe(false);
  });

  it('sendTurn after the session errored returns false', () => {
    const child = fakeChild();
    startSession({
      buildSessionId: 'tw4',
      projectDir: '/p',
      openingPrompt: 'x',
      spawnFn: (() => child) as never,
    });
    child.emit('close', 1); // non-zero exit → error
    expect(sendTurn('tw4', 'hi')).toBe(false);
  });
});
```

(Note: the existing Phase 1 test `'spawns claude ... and writes the opening prompt'` asserts `child.stdin.ended === true`. Update that one assertion to `expect(child.stdin.ended).toBe(false)`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/liveSession/engine.test.ts`
Expected: FAIL — `sendTurn` not exported; stdin is still ended; `result` still sets ended.

- [ ] **Step 3: Update `engine.ts`**

In `lib/liveSession/engine.ts`:

Remove the `result`→ended line from `emit` (keep error/exit handling):

```ts
const emit = (e: SessionEvent) => {
  session.buffer.push(e);
  if (e.kind === 'error' || (e.kind === 'exit' && e.code !== 0)) session.status = 'error';
  if (e.kind === 'exit' && e.code === 0) session.status = 'ended';
  emitter.emit('event', e);
};
```

Replace the one-shot tail (the `child.stdin.write(...)` + `child.stdin.end()` block) with just the opening write (keep stdin open):

```ts
// Send the opening prompt. Phase 2: keep stdin OPEN so follow-up turns can be
// written via sendTurn; the session ends on stopSession or child exit.
child.stdin.write(userLine(opts.openingPrompt));
```

Add `sendTurn` after `startSession`:

```ts
/** Write a follow-up user turn to the live child's stdin. No-op (returns false)
 *  if the session is missing or no longer running. */
export function sendTurn(buildSessionId: string, text: string): boolean {
  const s = getSession(buildSessionId);
  if (!s || s.status !== 'running') return false;
  try {
    s.child.stdin.write(userLine(text));
    return true;
  } catch {
    return false;
  }
}
```

(`getSession` is already imported. `LiveSession.child` already exposes `stdin.write`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/liveSession/engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck` → clean.

```bash
git add lib/liveSession/engine.ts lib/liveSession/engine.test.ts
git commit -m "feat(live-session): keep claude alive across turns + sendTurn"
```

---

### Task 3: `/send` route + stream stays open across turns

Add the send endpoint and stop the stream closing on `result`.

**Files:**

- Create: `app/api/build-session/send/route.ts`
- Modify: `app/api/build-session/stream/route.ts` (close only on `exit`/`error`)
- Test: `app/api/build-session/send/route.test.ts`

**Interfaces:**

- Consumes: `sendTurn` (Task 2); `detectCapability` (`lib/installer/capability.mjs`).
- Produces: `POST /api/build-session/send` `{ buildSessionId, text }` → `{ ok: true }` (200), `{ ok:false, reason:'remote' }` (409), `{ ok:false, reason:'bad_request' }` (400), or `{ ok:false, reason:'not_running' }` (409 when `sendTurn` returns false).

- [ ] **Step 1: Write the failing test**

Create `app/api/build-session/send/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockedFunction } from 'vitest';

vi.mock('@/lib/liveSession/engine', () => ({ sendTurn: vi.fn() }));
vi.mock('@/lib/installer/capability.mjs', () => ({ detectCapability: vi.fn() }));

import { POST } from './route';
import { sendTurn } from '@/lib/liveSession/engine';
import { detectCapability } from '@/lib/installer/capability.mjs';

const mockSend = sendTurn as MockedFunction<typeof sendTurn>;
const mockCap = detectCapability as MockedFunction<typeof detectCapability>;

const body = (b: unknown) =>
  new Request('http://localhost/api/build-session/send', {
    method: 'POST',
    body: JSON.stringify(b),
  });

beforeEach(() => {
  mockSend.mockReset();
  mockCap.mockReset();
});

describe('POST /api/build-session/send', () => {
  it('refuses in remote mode', async () => {
    mockCap.mockReturnValue({ mode: 'remote', reason: 'test' });
    const res = await POST(body({ buildSessionId: 'b1', text: 'hi' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, reason: 'remote' });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('sends a turn in local mode', async () => {
    mockCap.mockReturnValue({ mode: 'local', reason: 'test' });
    mockSend.mockReturnValue(true);
    const res = await POST(body({ buildSessionId: 'b1', text: 'now add tests' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockSend).toHaveBeenCalledWith('b1', 'now add tests');
  });

  it('rejects a bad body', async () => {
    mockCap.mockReturnValue({ mode: 'local', reason: 'test' });
    const res = await POST(body({ buildSessionId: '', text: '' }));
    expect(res.status).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('reports not_running when sendTurn fails', async () => {
    mockCap.mockReturnValue({ mode: 'local', reason: 'test' });
    mockSend.mockReturnValue(false);
    const res = await POST(body({ buildSessionId: 'b1', text: 'hi' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, reason: 'not_running' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/build-session/send/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write the send route**

Create `app/api/build-session/send/route.ts`:

```ts
// Send a follow-up user turn into a live in-UI Claude session (local mode only).
// Writes the turn to the persistent child's stdin via the engine. See the in-UI
// Claude session design spec (Phase 2).
import { NextResponse } from 'next/server';
import { sendTurn } from '@/lib/liveSession/engine';
import { detectCapability } from '@/lib/installer/capability.mjs';

export const runtime = 'nodejs';

interface SendBody {
  buildSessionId?: string;
  text?: string;
}

export async function POST(req: Request): Promise<Response> {
  if (detectCapability(process.env).mode !== 'local') {
    return NextResponse.json({ ok: false, reason: 'remote' }, { status: 409 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  }
  const { buildSessionId, text } = body as SendBody;
  if (!buildSessionId || !text || typeof text !== 'string' || !text.trim()) {
    return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  }
  const sent = sendTurn(buildSessionId, text.trim());
  if (!sent) {
    return NextResponse.json({ ok: false, reason: 'not_running' }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Keep the stream open across turns**

In `app/api/build-session/stream/route.ts`, change the close condition inside `onEvent` so a `result` (turn done) does NOT close the stream — only `exit`/`error` do:

```ts
onEvent = (e: SessionEvent) => {
  safeSend(e);
  if (e.kind === 'exit' || e.kind === 'error') {
    if (onEvent) session.emitter.off('event', onEvent);
    onEvent = null;
    closed = true;
    try {
      controller.close();
    } catch {
      /* already closed */
    }
  }
};
```

(The initial `if (session.status !== 'running')` replay-then-close guard stays: a client connecting to an already-ended/errored session still gets the buffer then closes.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run app/api/build-session/send/route.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck` → clean.

```bash
git add app/api/build-session/send/route.ts app/api/build-session/send/route.test.ts app/api/build-session/stream/route.ts
git commit -m "feat(live-session): /send route + stream persists across turns"
```

---

### Task 4: Composer + user bubbles in the UI (`useLiveSession.ts`, `LiveChat.tsx`)

Add a `send` action to the hook and a composer to the chat; render user turns.

**Files:**

- Modify: `lib/liveSession/useLiveSession.ts`
- Modify: `components/views/build/LiveChat.tsx`
- Modify: `app/globals.css`
- Test: `lib/liveSession/transcriptFromLines.test.ts` (add a `send`-injects-user-turn pure check via the reducer path is already covered; instead test the new `applyUserTurn` helper)

**Interfaces:**

- Consumes: `reduceTranscript` (Task 1); `/api/build-session/send` (Task 3).
- Produces:
  - `useLiveSession(...)` returns `{ state, start, stop, send }` where `send(text: string): Promise<void>` optimistically appends the user turn (via `reduceTranscript(..., { kind:'user-text', text })`) then POSTs `/send`.
  - Exported pure helper `applyUserTurn(state, text): TranscriptState` used by `send`.

- [ ] **Step 1: Write the failing test for the pure helper**

Add to `lib/liveSession/transcriptFromLines.test.ts`:

```ts
import { applyUserTurn } from './useLiveSession';

describe('applyUserTurn', () => {
  it('appends the user message and sets running', () => {
    const s = applyUserTurn(initialTranscript(), 'now add tests');
    expect(s.messages).toEqual([{ role: 'user', text: 'now add tests' }]);
    expect(s.status).toBe('running');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/liveSession/transcriptFromLines.test.ts`
Expected: FAIL — `applyUserTurn` not exported.

- [ ] **Step 3: Add `applyUserTurn` + `send` to the hook**

In `lib/liveSession/useLiveSession.ts`, add the pure helper near `applyLine`:

```ts
/** Pure: optimistically append the user's own turn and return to running. */
export function applyUserTurn(state: TranscriptState, text: string): TranscriptState {
  return reduceTranscript(state, { kind: 'user-text', text });
}
```

Inside `useLiveSession`, add a `send` callback (after `stop`) and include it in the return:

```ts
const send = useCallback(
  async (text: string) => {
    const t = text.trim();
    if (!t) return;
    setState((s) => applyUserTurn(s, t));
    try {
      await fetch('/api/build-session/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ buildSessionId: opts.buildSessionId, text: t }),
      });
    } catch {
      setState((s) =>
        reduceTranscript(s, { kind: 'error', message: 'Could not send that message.' }),
      );
    }
  },
  [opts.buildSessionId],
);

return { state, start, stop, send };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/liveSession/transcriptFromLines.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the composer + user bubbles to `LiveChat.tsx`**

Replace `components/views/build/LiveChat.tsx` with the two-way version (user/assistant bubbles + composer; composer enabled only when `awaiting-input`):

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useLiveSession } from '@/lib/liveSession/useLiveSession';
import type { BytePlan } from '@/lib/ai/plan';

// Phase 2: two-way live transcript of the real `claude` session. User and assistant
// turns render as chat bubbles; tool activity is listed below; a composer sends
// follow-up turns when the session is awaiting input. See the in-UI session spec.
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
  const { state, start, stop, send } = useLiveSession({ buildSessionId, projectDir, plan, brief });
  const [draft, setDraft] = useState('');

  useEffect(() => {
    start();
    return () => stop();
  }, [start, stop]);

  const canSend = state.status === 'awaiting-input' && draft.trim().length > 0;
  const submit = () => {
    if (!canSend) return;
    send(draft);
    setDraft('');
  };

  return (
    <div className="lc-wrap">
      <div className="lc-feed">
        {state.messages.map((m, i) => (
          <div key={`m${i}`} className={`lc-msg ${m.role}`}>
            {m.text}
          </div>
        ))}
        {state.tools.map((t) => (
          <div key={t.id} className={`lc-tool${t.ok === false ? ' err' : ''}`}>
            <b>{t.name}</b>
            {t.summary ? <span className="lc-tool-sum"> — {t.summary.slice(0, 120)}</span> : null}
          </div>
        ))}
        {state.status === 'running' && <div className="lc-status">Claude is working…</div>}
        {state.status === 'error' && (
          <div className="lc-err">{state.error ?? 'Something went wrong.'}</div>
        )}
        {state.status === 'ended' && <div className="lc-done">Session finished.</div>}
      </div>
      <div className="lc-composer">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder={
            state.status === 'awaiting-input'
              ? 'Reply to Claude…'
              : state.status === 'running'
                ? 'Claude is working — hang on…'
                : 'Session is not active'
          }
          disabled={state.status !== 'awaiting-input'}
        />
        <button className="lc-send" onClick={submit} disabled={!canSend}>
          Send
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Styles for bubbles + composer**

In `app/globals.css`, replace the `.lc-msg` rule and append the new rules:

```css
.lc-msg {
  white-space: pre-wrap;
  line-height: 1.4;
  padding: 8px 10px;
  border-radius: 10px;
  max-width: 85%;
}
.lc-msg.assistant {
  background: #fff;
  align-self: flex-start;
}
.lc-msg.user {
  background: #efe6ff;
  align-self: flex-end;
}
.lc-status {
  opacity: 0.6;
  font-size: 13px;
  font-style: italic;
}
.lc-composer {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.lc-composer textarea {
  flex: 1;
  resize: vertical;
  border-radius: 10px;
  padding: 8px 10px;
  border: 1px solid #e3d9f5;
  font: inherit;
}
.lc-composer textarea:disabled {
  opacity: 0.55;
}
.lc-send {
  padding: 0 16px;
  border-radius: 10px;
  border: none;
  background: #7c4dff;
  color: #fff;
  cursor: pointer;
}
.lc-send:disabled {
  opacity: 0.4;
  cursor: default;
}
```

- [ ] **Step 7: Typecheck + commit**

Run: `npm run typecheck` → clean.

```bash
git add lib/liveSession/useLiveSession.ts lib/liveSession/transcriptFromLines.test.ts components/views/build/LiveChat.tsx app/globals.css
git commit -m "feat(live-session): composer + user bubbles for two-way chat"
```

---

### Task 5: Verification

**Files:** none.

- [ ] **Step 1: Full suite** — Run: `npm test` → PASS (incl. `liveSession/*`, `build-session/*`).
- [ ] **Step 2: Installer suite** — Run: `npm run test:installer` → PASS.
- [ ] **Step 3: Types + lint + format** — Run: `npm run typecheck && npm run lint` → no type errors, 0 lint errors. Then check tracked files: `npm run format:check` (prettier-write any tracked file it flags).
- [ ] **Step 4: End-to-end (real `claude`)** — `npm run dev` → Let's build → plan → pick a real repo → Start. Confirm the first turn streams, then the composer enables when Claude finishes ("awaiting input"); type a follow-up, Send, and confirm it appears as a user bubble and Claude responds in the same transcript. Confirm the session stays open across several turns and only ends when you leave/stop.

---

## Self-Review

**Spec coverage (Phase 2 scope):**

- Keep the process alive across turns → Task 2 (no `stdin.end()`). ✓
- User types follow-up turns from the UI → Task 3 (`/send`) + Task 4 (composer, `send`). ✓
- `result` = turn done (awaiting-input), not ended → Task 1 (reducer) + Task 2 (engine status) + Task 3 (stream). ✓
- Status handling (awaiting-input) → Task 1 + Task 4 (composer enable/disable). ✓
- Local-mode-only send → Task 3. ✓
- (Phase 3 UI permissions remain out of this plan — still `acceptEdits`.)

**Placeholder scan:** No TBD/"handle edge cases"; every code step is complete.

**Type consistency:** `SessionEvent` `user-text` member (Task 1) used by `applyUserTurn` (Task 4) and the reducer; `TranscriptState.status`/`messages` widened once (Task 1) and consumed in Task 4; `sendTurn(id, text): boolean` consistent Tasks 2/3; route contracts (`{ ok, reason }`) consistent Tasks 3/4; `useLiveSession` returns `{ state, start, stop, send }` (Task 4).

**Note on superseded Phase 1 tests:** Task 1 rewrites the reducer lifecycle tests and Task 2 flips one engine assertion (`stdin.ended` false) — intentional, because Phase 2 changes the one-shot lifecycle to persistent. Called out in Global Constraints.
