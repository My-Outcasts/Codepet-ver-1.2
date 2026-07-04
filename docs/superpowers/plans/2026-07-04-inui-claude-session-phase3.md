# In-UI Claude Code session — Phase 3 (UI permissions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Claude wants to run a tool (edit a file, run a command), show an Allow / Deny card in the DURING step and let the user's decision drive the real session — replacing Phase 1/2's `acceptEdits` auto-approval.

**Architecture:** Launch `claude` with `--permission-prompt-tool codepet_permit` and an `--mcp-config` pointing at a tiny local stdio MCP server (`permissionServer.mjs`). When Claude asks permission, the CLI calls `codepet_permit`; that MCP server POSTs the request to the local app (`/api/build-session/permission/enqueue`) and blocks on the HTTP response. The route parks the request in the session registry, emits a `permission-request` event (so the UI shows an Allow/Deny card over the same open stream), and holds the response open until the user decides via `/api/build-session/permission`, which resolves the parked promise → the held enqueue response returns `{ decision }` → the MCP server returns it to Claude.

**Tech Stack:** Next.js 16 (App Router, `runtime='nodejs'`), React 19, TypeScript, `node:child_process`, `node:fs`/`os` (temp mcp-config), Vitest, `node --test` (for `permissionServer.mjs`).

> **LIVE-VALIDATION CAVEAT:** the exact `--permission-prompt-tool` MCP input/output contract and `--mcp-config` shape are inferred from Claude Code docs, not officially specified. Every PURE and LOCAL piece here is unit-tested, but the actual CLI↔MCP handshake can only be confirmed with a real `claude` session (Task 6, Step 4). Treat the JSON shapes in `permissionServer.mjs` and `CLAUDE_ARGS` as the best-known contract, isolated so they're cheap to adjust after the live check.

## Global Constraints

- **Local mode only.** New routes gate on `detectCapability(process.env).mode` like `/start` and `/send`.
- **Pure logic never throws** (`transcript.ts`, `parseEvents.ts`, `permissionServer.mjs` mapping): bad input → safe default (a permission with no decision defaults to **deny**).
- **A parked permission auto-denies after a timeout** (`PERMISSION_TIMEOUT_MS = 120_000`) so a walked-away user never wedges the child.
- **`permission-request` is emitted server-side** (by the enqueue route), never parsed from Claude stdout — it belongs in the shared `SessionEvent` union like `user-text`.
- The permission bridge is scoped to a known `buildSessionId`; an enqueue/resolve for an unknown session is rejected.
- Replaces `--permission-mode acceptEdits` in `CLAUDE_ARGS` with the prompt-tool wiring.
- English UI copy; follow existing route/UI patterns.

---

### Task 1: Permission event model (`parseEvents.ts`, `transcript.ts`)

Add the `permission-request` event and the transcript's `pendingPermission`.

**Files:**

- Modify: `lib/liveSession/parseEvents.ts` (union member)
- Modify: `lib/liveSession/transcript.ts`
- Test: `lib/liveSession/transcript.test.ts`

**Interfaces:**

- Produces:
  - `SessionEvent` gains `| { kind: 'permission-request'; requestId: string; tool: string; input: unknown }`.
  - `TranscriptState` gains `pendingPermission?: { requestId: string; tool: string; input: unknown }`.
  - `reduceTranscript`: `permission-request` → set `pendingPermission` + status `'awaiting-permission'`; a `tool-use` clears `pendingPermission` and returns to `running` (Claude proceeded); an `error`/`exit` clears it too.
  - `TranscriptState.status` gains `'awaiting-permission'`.

- [ ] **Step 1: Write the failing tests**

Add to `lib/liveSession/transcript.test.ts`:

```ts
it('a permission-request parks a pending permission and awaits it', () => {
  const s = run([
    { kind: 'permission-request', requestId: 'r1', tool: 'Bash', input: { command: 'ls' } },
  ]);
  expect(s.pendingPermission).toEqual({ requestId: 'r1', tool: 'Bash', input: { command: 'ls' } });
  expect(s.status).toBe('awaiting-permission');
});

it('a tool-use clears a pending permission and returns to running', () => {
  const s = run([
    { kind: 'permission-request', requestId: 'r1', tool: 'Bash', input: {} },
    { kind: 'tool-use', id: 't1', name: 'Bash', input: {} },
  ]);
  expect(s.pendingPermission).toBeUndefined();
  expect(s.status).toBe('running');
});

it('an error clears a pending permission', () => {
  const s = run([
    { kind: 'permission-request', requestId: 'r1', tool: 'Bash', input: {} },
    { kind: 'error', message: 'boom' },
  ]);
  expect(s.pendingPermission).toBeUndefined();
  expect(s.status).toBe('error');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/liveSession/transcript.test.ts`
Expected: FAIL — `permission-request` unhandled; `pendingPermission`/`awaiting-permission` unknown.

- [ ] **Step 3: Add the union member**

In `lib/liveSession/parseEvents.ts`, add to the `SessionEvent` union (after `tool-result`):

```ts
  | { kind: 'permission-request'; requestId: string; tool: string; input: unknown }
```

- [ ] **Step 4: Update `transcript.ts`**

Change the `status` union and add `pendingPermission`:

```ts
export interface TranscriptState {
  sessionId?: string;
  status: 'running' | 'awaiting-input' | 'awaiting-permission' | 'ended' | 'error';
  messages: Array<{ role: 'user' | 'assistant'; text: string }>;
  tools: ToolActivity[];
  actionCount: number;
  pendingPermission?: { requestId: string; tool: string; input: unknown };
  error?: string;
}
```

Add a `permission-request` case and clear `pendingPermission` on `tool-use`/`error`/`exit`. Replace the `tool-use`, `error`, and `exit` cases and add `permission-request`:

```ts
    case 'tool-use': {
      const { pendingPermission: _drop, ...rest } = state;
      return {
        ...rest,
        status: 'running',
        tools: [...state.tools, { id: event.id, name: event.name, input: event.input }],
        actionCount: state.actionCount + 1,
      };
    }
    case 'permission-request':
      return {
        ...state,
        status: 'awaiting-permission',
        pendingPermission: { requestId: event.requestId, tool: event.tool, input: event.input },
      };
    case 'error': {
      const { pendingPermission: _d, ...rest } = state;
      return { ...rest, status: 'error', error: event.message };
    }
    case 'exit': {
      const { pendingPermission: _d, ...rest } = state;
      if (rest.status === 'error') return { ...rest, pendingPermission: undefined } as TranscriptState;
      return event.code === 0
        ? { ...rest, status: 'ended' }
        : { ...rest, status: 'error', error: rest.error ?? `claude exited with code ${event.code}` };
    }
```

Note: destructuring `pendingPermission` off `state` and spreading `rest` drops the key cleanly (no `undefined` value left). Leave `init`/`assistant-text`/`user-text`/`result`/`tool-result`/`default` unchanged.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/liveSession/transcript.test.ts`
Expected: PASS (existing + new).

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck` → clean.

```bash
git add lib/liveSession/parseEvents.ts lib/liveSession/transcript.ts lib/liveSession/transcript.test.ts
git commit -m "feat(live-session): permission-request event + pendingPermission state"
```

---

### Task 2: Permission bridge in the engine (`registry.ts`, `engine.ts`)

Park/resolve permission promises; emit the `permission-request` event; switch `CLAUDE_ARGS` to the prompt-tool wiring + write the mcp-config.

**Files:**

- Modify: `lib/liveSession/registry.ts` (add `pending`)
- Modify: `lib/liveSession/engine.ts`
- Test: `lib/liveSession/engine.test.ts`

**Interfaces:**

- Consumes: `getSession` (registry); `SessionEvent` (Task 1).
- Produces:
  - `LiveSession` gains `pending: Map<string, (d: PermissionDecision) => void>`.
  - `type PermissionDecision = { decision: 'allow' | 'deny'; reason?: string }`.
  - `enqueuePermission(buildSessionId, req: { requestId; tool; input }): Promise<PermissionDecision>` — emits a `permission-request` event, parks a resolver in `pending`, resolves when `resolvePermission` is called or after `PERMISSION_TIMEOUT_MS` (auto-deny). Rejects (resolves to deny) if the session is missing.
  - `resolvePermission(buildSessionId, requestId, decision: PermissionDecision): boolean` — resolves the parked promise; false if not found.
  - `PERMISSION_TIMEOUT_MS` exported.
  - `CLAUDE_ARGS` no longer has `--permission-mode acceptEdits`; instead the engine passes `--permission-prompt-tool` + `--mcp-config` at spawn time (built per session, so tests assert the flags are present).

- [ ] **Step 1: Write the failing tests**

Add to `lib/liveSession/engine.test.ts`:

```ts
import { enqueuePermission, resolvePermission, PERMISSION_TIMEOUT_MS } from './engine';

describe('permission bridge', () => {
  it('enqueue emits a permission-request and resolves when the user decides', async () => {
    const child = fakeChild();
    const events: SessionEvent[] = [];
    startSession({
      buildSessionId: 'pm1',
      projectDir: '/p',
      openingPrompt: 'x',
      spawnFn: (() => child) as never,
    });
    getSession('pm1')!.emitter.on('event', (e: SessionEvent) => events.push(e));

    const p = enqueuePermission('pm1', { requestId: 'r1', tool: 'Bash', input: { command: 'ls' } });
    expect(events).toContainEqual({
      kind: 'permission-request',
      requestId: 'r1',
      tool: 'Bash',
      input: { command: 'ls' },
    });

    const resolved = resolvePermission('pm1', 'r1', { decision: 'allow' });
    expect(resolved).toBe(true);
    await expect(p).resolves.toEqual({ decision: 'allow' });
  });

  it('enqueue on a missing session resolves to deny', async () => {
    await expect(
      enqueuePermission('nope', { requestId: 'r', tool: 'X', input: {} }),
    ).resolves.toEqual({
      decision: 'deny',
      reason: 'no such session',
    });
  });

  it('resolvePermission for an unknown request returns false', () => {
    const child = fakeChild();
    startSession({
      buildSessionId: 'pm2',
      projectDir: '/p',
      openingPrompt: 'x',
      spawnFn: (() => child) as never,
    });
    expect(resolvePermission('pm2', 'ghost', { decision: 'allow' })).toBe(false);
  });

  it('spawns claude with the permission-prompt-tool wiring (no acceptEdits)', () => {
    const child = fakeChild();
    const spawnFn = vi.fn(() => child) as never;
    startSession({ buildSessionId: 'pm3', projectDir: '/p', openingPrompt: 'x', spawnFn });
    const args: string[] = (spawnFn as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][1] as string[];
    expect(args).not.toContain('acceptEdits');
    expect(args).toContain('--permission-prompt-tool');
    expect(args).toContain('codepet_permit');
    expect(args).toContain('--mcp-config');
  });
});

it('PERMISSION_TIMEOUT_MS is a positive number', () => {
  expect(PERMISSION_TIMEOUT_MS).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/liveSession/engine.test.ts`
Expected: FAIL — new exports missing; args still contain `acceptEdits`.

- [ ] **Step 3: Add `pending` to the registry**

In `lib/liveSession/registry.ts`, add to `LiveSession`:

```ts
export type PermissionDecision = { decision: 'allow' | 'deny'; reason?: string };

export interface LiveSession {
  emitter: EventEmitter;
  child: { stdin: { write(s: string): void; end(): void }; kill(): void };
  status: 'running' | 'ended' | 'error';
  buffer: SessionEvent[];
  pending: Map<string, (d: PermissionDecision) => void>;
}
```

- [ ] **Step 4: Update `engine.ts`**

At the top, add imports and the timeout constant:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PermissionDecision } from './registry';

export const PERMISSION_TIMEOUT_MS = 120_000;
```

Replace `CLAUDE_ARGS` (drop the `acceptEdits` pair) — the per-session flags are appended at spawn time:

```ts
/** Base headless streaming args. The permission wiring (--permission-prompt-tool +
 *  --mcp-config) is appended per session in startSession, since the mcp-config path
 *  is session-specific. */
export const CLAUDE_ARGS = [
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
];
```

In `startSession`, initialise `pending`, write a per-session mcp-config, and pass the permission flags. Change the `session` init and the spawn:

```ts
const spawnFn = opts.spawnFn ?? defaultSpawn;
const mcpConfigPath = writeMcpConfig(opts.buildSessionId);
const args = [
  ...CLAUDE_ARGS,
  '--permission-prompt-tool',
  'codepet_permit',
  '--mcp-config',
  mcpConfigPath,
];
const child = spawnFn('claude', args, { cwd: opts.projectDir });
const emitter = new EventEmitter();
const session: LiveSession = { emitter, child, status: 'running', buffer: [], pending: new Map() };
setSession(opts.buildSessionId, session);
```

Add the mcp-config writer (points at the permission server; passes the session id + app url via env so the server can call back). Put it above `startSession`:

```ts
/** Write a per-session MCP config that launches the permission bridge server for
 *  this build session. The server reads CODEPET_BUILD_SESSION_ID + CODEPET_API_URL
 *  to call back into the app. Returns the config file path. */
function writeMcpConfig(buildSessionId: string): string {
  const serverPath = path.join(process.cwd(), 'lib', 'liveSession', 'permissionServer.mjs');
  const cfg = {
    mcpServers: {
      codepet_permit: {
        command: 'node',
        args: [serverPath],
        env: {
          CODEPET_BUILD_SESSION_ID: buildSessionId,
          CODEPET_API_URL: process.env.CODEPET_API_URL || 'http://127.0.0.1:3000',
        },
      },
    },
  };
  const file = path.join(os.tmpdir(), `codepet-mcp-${buildSessionId}.json`);
  fs.writeFileSync(file, JSON.stringify(cfg));
  return file;
}
```

Add `enqueuePermission`/`resolvePermission` after `sendTurn`:

```ts
/** Park a permission request: emit it to the UI and return a promise that resolves
 *  when the user decides (via resolvePermission) or after PERMISSION_TIMEOUT_MS
 *  (auto-deny). A missing session resolves to deny immediately. */
export function enqueuePermission(
  buildSessionId: string,
  req: { requestId: string; tool: string; input: unknown },
): Promise<PermissionDecision> {
  const s = getSession(buildSessionId);
  if (!s) return Promise.resolve({ decision: 'deny', reason: 'no such session' });
  return new Promise<PermissionDecision>((resolve) => {
    let done = false;
    const finish = (d: PermissionDecision) => {
      if (done) return;
      done = true;
      s.pending.delete(req.requestId);
      resolve(d);
    };
    s.pending.set(req.requestId, finish);
    setTimeout(() => finish({ decision: 'deny', reason: 'timed out' }), PERMISSION_TIMEOUT_MS);
    // Emit through the same buffer/emitter path so the stream + UI see it.
    const event = {
      kind: 'permission-request' as const,
      requestId: req.requestId,
      tool: req.tool,
      input: req.input,
    };
    s.buffer.push(event);
    s.emitter.emit('event', event);
  });
}

/** Resolve a parked permission with the user's decision. False if not found. */
export function resolvePermission(
  buildSessionId: string,
  requestId: string,
  decision: PermissionDecision,
): boolean {
  const s = getSession(buildSessionId);
  const resolver = s?.pending.get(requestId);
  if (!resolver) return false;
  resolver(decision);
  return true;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/liveSession/engine.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck` → clean.

```bash
git add lib/liveSession/registry.ts lib/liveSession/engine.ts lib/liveSession/engine.test.ts
git commit -m "feat(live-session): permission enqueue/resolve bridge + prompt-tool wiring"
```

---

### Task 3: The permission MCP server (`permissionServer.mjs`)

The stdio MCP server Claude calls; it bridges to the app and returns the decision.

**Files:**

- Create: `lib/liveSession/permissionServer.mjs`
- Test: `lib/liveSession/permissionServer.test.mjs`

**Interfaces:**

- Produces (pure, testable):
  - `toDecisionResult(decision): { content: [{ type:'text', text }] }` — wrap a `{decision, reason}` as the MCP tool result the CLI expects (text is JSON `{ decision, reason }`).
  - `parsePermissionInput(raw): { tool, input }` — coerce the CLI's tool-call input (`{ tool_name, tool_input }`) into our request shape; unknown → `{ tool: 'unknown', input: null }`.
  - `requestBody(buildSessionId, requestId, parsed)` — the JSON body POSTed to `/api/build-session/permission/enqueue`.
  - `denyResult(reason)` — the fail-safe result when the bridge is unreachable.
- The transport (reading MCP stdio, POSTing, returning) is thin glue around these; unit tests cover the pure mappers, and the file guards every step so a broken bridge → **deny** (never crashes Claude).

- [ ] **Step 1: Write the failing tests**

Create `lib/liveSession/permissionServer.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toDecisionResult,
  parsePermissionInput,
  requestBody,
  denyResult,
} from './permissionServer.mjs';

test('parsePermissionInput coerces the CLI tool-call shape', () => {
  assert.deepEqual(parsePermissionInput({ tool_name: 'Bash', tool_input: { command: 'ls' } }), {
    tool: 'Bash',
    input: { command: 'ls' },
  });
});

test('parsePermissionInput falls back safely on odd input', () => {
  assert.deepEqual(parsePermissionInput(null), { tool: 'unknown', input: null });
  assert.deepEqual(parsePermissionInput({}), { tool: 'unknown', input: null });
});

test('toDecisionResult wraps a decision as an MCP text result', () => {
  const r = toDecisionResult({ decision: 'allow' });
  assert.equal(r.content[0].type, 'text');
  assert.deepEqual(JSON.parse(r.content[0].text), { decision: 'allow' });
});

test('denyResult is a deny decision result with a reason', () => {
  const r = denyResult('bridge down');
  assert.deepEqual(JSON.parse(r.content[0].text), { decision: 'deny', reason: 'bridge down' });
});

test('requestBody carries the ids and parsed request', () => {
  assert.deepEqual(requestBody('b1', 'r1', { tool: 'Bash', input: { command: 'ls' } }), {
    buildSessionId: 'b1',
    requestId: 'r1',
    tool: 'Bash',
    input: { command: 'ls' },
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test lib/liveSession/permissionServer.test.mjs`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `permissionServer.mjs`**

Create `lib/liveSession/permissionServer.mjs`:

```js
#!/usr/bin/env node
// MCP permission bridge for the in-UI Claude session. Claude Code (launched with
// --permission-prompt-tool codepet_permit --mcp-config <this>) calls the tool
// `codepet_permit` for each permission decision. This server forwards the request
// to the local Codepet app, which shows an Allow/Deny card and returns the user's
// choice. FAIL-SAFE: any error → deny, so a broken bridge never lets a tool run
// unattended and never crashes Claude. The CLI↔MCP contract here is best-known
// (see the Phase 3 plan's live-validation caveat).
//
// Pure mappers are exported for unit tests; the stdio loop runs only when invoked
// as a script.
import readline from 'node:readline';

const BUILD_SESSION_ID = process.env.CODEPET_BUILD_SESSION_ID || '';
const API_URL = (process.env.CODEPET_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

/** Coerce the CLI's permission tool-call input into our request shape. */
export function parsePermissionInput(raw) {
  if (!raw || typeof raw !== 'object') return { tool: 'unknown', input: null };
  const tool = typeof raw.tool_name === 'string' && raw.tool_name ? raw.tool_name : 'unknown';
  const input = 'tool_input' in raw ? raw.tool_input : null;
  return { tool, input: tool === 'unknown' ? null : input };
}

/** Wrap a {decision, reason} as the MCP tool result the CLI expects. */
export function toDecisionResult(decision) {
  return { content: [{ type: 'text', text: JSON.stringify(decision) }] };
}

/** The fail-safe result when the bridge can't reach the app. */
export function denyResult(reason) {
  return toDecisionResult({ decision: 'deny', reason });
}

/** The body POSTed to /api/build-session/permission/enqueue. */
export function requestBody(buildSessionId, requestId, parsed) {
  return { buildSessionId, requestId, tool: parsed.tool, input: parsed.input };
}

/** Ask the app for a decision. Returns a decision result; deny on any failure. */
async function askApp(requestId, parsed) {
  try {
    const res = await fetch(`${API_URL}/api/build-session/permission/enqueue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody(BUILD_SESSION_ID, requestId, parsed)),
    });
    if (!res.ok) return denyResult(`bridge returned ${res.status}`);
    const data = await res.json();
    const decision =
      data && data.decision === 'allow'
        ? { decision: 'allow' }
        : { decision: 'deny', reason: data?.reason };
    return toDecisionResult(decision);
  } catch (e) {
    return denyResult(e instanceof Error ? e.message : 'bridge unreachable');
  }
}

// Minimal MCP stdio loop: respond to initialize / tools/list / tools/call. Only the
// codepet_permit tool is exposed. Kept intentionally small; the pure mappers above
// carry the logic under test.
function main() {
  const rl = readline.createInterface({ input: process.stdin });
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
  rl.on('line', async (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'codepet-permit', version: '1.0.0' },
        },
      });
    } else if (msg.method === 'tools/list') {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          tools: [
            {
              name: 'codepet_permit',
              description: 'Ask the Codepet user to allow or deny a tool call.',
              inputSchema: { type: 'object' },
            },
          ],
        },
      });
    } else if (msg.method === 'tools/call') {
      const requestId = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      const parsed = parsePermissionInput(msg.params?.arguments ?? msg.params?.input);
      const result = await askApp(requestId, parsed);
      send({ jsonrpc: '2.0', id: msg.id, result });
    }
  });
}

// Run the loop only as a script (not when imported for tests). import.meta.url ends
// with the invoked path when run directly.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test lib/liveSession/permissionServer.test.mjs`
Expected: PASS. (It is under `lib/liveSession/`, which `test:installer`'s glob does not cover — run it directly, and add it in Task 6.)

- [ ] **Step 5: Commit**

```bash
git add lib/liveSession/permissionServer.mjs lib/liveSession/permissionServer.test.mjs
git commit -m "feat(live-session): MCP permission bridge server (fail-safe deny)"
```

---

### Task 4: Permission routes (`/permission`, `/permission/enqueue`)

The two HTTP endpoints that connect the MCP server, the registry, and the UI.

**Files:**

- Create: `app/api/build-session/permission/route.ts` (client → resolve)
- Create: `app/api/build-session/permission/enqueue/route.ts` (MCP server → park + await)
- Test: `app/api/build-session/permission/route.test.ts`

**Interfaces:**

- Consumes: `resolvePermission`, `enqueuePermission` (Task 2); `detectCapability`.
- Produces:
  - `POST /api/build-session/permission` `{ buildSessionId, requestId, decision }` → `{ ok:true }` (200), `{ ok:false, reason }` (409 remote / 400 bad / 409 not_found).
  - `POST /api/build-session/permission/enqueue` `{ buildSessionId, requestId, tool, input }` → awaits `enqueuePermission`, returns the resolved `{ decision, reason? }` (200) or `{ decision:'deny', reason:'bad_request' }` (400 on bad body). Local-only.

- [ ] **Step 1: Write the failing test (client resolve route)**

Create `app/api/build-session/permission/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockedFunction } from 'vitest';

vi.mock('@/lib/liveSession/engine', () => ({ resolvePermission: vi.fn() }));
vi.mock('@/lib/installer/capability.mjs', () => ({ detectCapability: vi.fn() }));

import { POST } from './route';
import { resolvePermission } from '@/lib/liveSession/engine';
import { detectCapability } from '@/lib/installer/capability.mjs';

const mockResolve = resolvePermission as MockedFunction<typeof resolvePermission>;
const mockCap = detectCapability as MockedFunction<typeof detectCapability>;

const body = (b: unknown) =>
  new Request('http://localhost/api/build-session/permission', {
    method: 'POST',
    body: JSON.stringify(b),
  });

beforeEach(() => {
  mockResolve.mockReset();
  mockCap.mockReset();
});

describe('POST /api/build-session/permission', () => {
  it('refuses in remote mode', async () => {
    mockCap.mockReturnValue({ mode: 'remote', reason: 'test' });
    const res = await POST(body({ buildSessionId: 'b1', requestId: 'r1', decision: 'allow' }));
    expect(res.status).toBe(409);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('resolves an allow decision', async () => {
    mockCap.mockReturnValue({ mode: 'local', reason: 'test' });
    mockResolve.mockReturnValue(true);
    const res = await POST(body({ buildSessionId: 'b1', requestId: 'r1', decision: 'allow' }));
    expect(res.status).toBe(200);
    expect(mockResolve).toHaveBeenCalledWith('b1', 'r1', { decision: 'allow' });
  });

  it('maps a deny decision', async () => {
    mockCap.mockReturnValue({ mode: 'local', reason: 'test' });
    mockResolve.mockReturnValue(true);
    await POST(body({ buildSessionId: 'b1', requestId: 'r1', decision: 'deny' }));
    expect(mockResolve).toHaveBeenCalledWith('b1', 'r1', { decision: 'deny' });
  });

  it('rejects a bad decision value', async () => {
    mockCap.mockReturnValue({ mode: 'local', reason: 'test' });
    const res = await POST(body({ buildSessionId: 'b1', requestId: 'r1', decision: 'maybe' }));
    expect(res.status).toBe(400);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('reports not_found when the request is unknown', async () => {
    mockCap.mockReturnValue({ mode: 'local', reason: 'test' });
    mockResolve.mockReturnValue(false);
    const res = await POST(body({ buildSessionId: 'b1', requestId: 'ghost', decision: 'allow' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, reason: 'not_found' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/build-session/permission/route.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the client-resolve route**

Create `app/api/build-session/permission/route.ts`:

```ts
// The user's Allow/Deny decision from the UI. Resolves the parked permission the
// MCP bridge is awaiting, so the real claude session proceeds or skips the tool.
// Local mode only. See the in-UI Claude session design spec (Phase 3).
import { NextResponse } from 'next/server';
import { resolvePermission } from '@/lib/liveSession/engine';
import { detectCapability } from '@/lib/installer/capability.mjs';

export const runtime = 'nodejs';

interface Body {
  buildSessionId?: string;
  requestId?: string;
  decision?: string;
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
  const { buildSessionId, requestId, decision } = body as Body;
  if (!buildSessionId || !requestId || (decision !== 'allow' && decision !== 'deny')) {
    return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  }
  const ok = resolvePermission(buildSessionId, requestId, { decision });
  if (!ok) {
    return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Write the enqueue route**

Create `app/api/build-session/permission/enqueue/route.ts`:

```ts
// Called by the local MCP permission bridge (permissionServer.mjs) when claude asks
// to run a tool. Parks the request (surfacing an Allow/Deny card in the UI) and holds
// this response open until the user decides or it times out, then returns the
// decision to the bridge. Local mode only.
import { NextResponse } from 'next/server';
import { enqueuePermission } from '@/lib/liveSession/engine';
import { detectCapability } from '@/lib/installer/capability.mjs';

export const runtime = 'nodejs';

interface Body {
  buildSessionId?: string;
  requestId?: string;
  tool?: string;
  input?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  if (detectCapability(process.env).mode !== 'local') {
    return NextResponse.json({ decision: 'deny', reason: 'remote' }, { status: 409 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ decision: 'deny', reason: 'bad_request' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ decision: 'deny', reason: 'bad_request' }, { status: 400 });
  }
  const { buildSessionId, requestId, tool, input } = body as Body;
  if (!buildSessionId || !requestId || !tool) {
    return NextResponse.json({ decision: 'deny', reason: 'bad_request' }, { status: 400 });
  }
  const decision = await enqueuePermission(buildSessionId, { requestId, tool, input });
  return NextResponse.json(decision);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run app/api/build-session/permission/route.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck` → clean.

```bash
git add app/api/build-session/permission/
git commit -m "feat(live-session): /permission (resolve) + /permission/enqueue (park) routes"
```

---

### Task 5: Allow/Deny card in the UI (`useLiveSession.ts`, `LiveChat.tsx`)

Surface the pending permission and let the user decide.

**Files:**

- Modify: `lib/liveSession/useLiveSession.ts` (add `decide`)
- Modify: `components/views/build/LiveChat.tsx`
- Modify: `app/globals.css`
- Test: `lib/liveSession/transcriptFromLines.test.ts` (pure helper)

**Interfaces:**

- Consumes: `reduceTranscript` (Task 1); `/api/build-session/permission` (Task 4).
- Produces:
  - `applyDecision(state): TranscriptState` — pure: clear `pendingPermission`, set status `running` (optimistic on decide).
  - `useLiveSession(...)` returns `{ state, start, stop, send, decide }` where `decide(requestId, decision: 'allow' | 'deny'): Promise<void>` optimistically clears the card then POSTs `/permission`.

- [ ] **Step 1: Write the failing test for the pure helper**

Add to `lib/liveSession/transcriptFromLines.test.ts`:

```ts
import { applyDecision } from './useLiveSession';

describe('applyDecision', () => {
  it('clears the pending permission and returns to running', () => {
    const withPerm = applyLine(
      initialTranscript(),
      JSON.stringify({ kind: 'permission-request', requestId: 'r1', tool: 'Bash', input: {} }),
    );
    expect(withPerm.pendingPermission).toBeDefined();
    const s = applyDecision(withPerm);
    expect(s.pendingPermission).toBeUndefined();
    expect(s.status).toBe('running');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/liveSession/transcriptFromLines.test.ts`
Expected: FAIL — `applyDecision` not exported.

- [ ] **Step 3: Add `applyDecision` + `decide` to the hook**

In `lib/liveSession/useLiveSession.ts`, add the pure helper near `applyUserTurn`:

```ts
/** Pure: optimistically clear the pending permission and return to running once the
 *  user has decided (the real proceed/skip arrives as tool events over the stream). */
export function applyDecision(state: TranscriptState): TranscriptState {
  if (!state.pendingPermission) return state;
  const { pendingPermission: _drop, ...rest } = state;
  return { ...rest, status: 'running' };
}
```

Add a `decide` callback in `useLiveSession` (after `send`) and include it in the return:

```ts
const decide = useCallback(
  async (requestId: string, decision: 'allow' | 'deny') => {
    setState((s) => applyDecision(s));
    try {
      const res = await fetch('/api/build-session/permission', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ buildSessionId: opts.buildSessionId, requestId, decision }),
      });
      if (!res.ok) {
        setState((s) =>
          reduceTranscript(s, { kind: 'error', message: 'Could not send that decision.' }),
        );
      }
    } catch {
      setState((s) =>
        reduceTranscript(s, { kind: 'error', message: 'Could not send that decision.' }),
      );
    }
  },
  [opts.buildSessionId],
);

return { state, start, stop, send, decide };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/liveSession/transcriptFromLines.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the permission card to `LiveChat.tsx`**

In `components/views/build/LiveChat.tsx`, destructure `decide` from the hook and render a card when `state.pendingPermission` is set (place it just above the composer). Change the hook destructure line:

```tsx
const { state, start, stop, send, decide } = useLiveSession({
  buildSessionId,
  projectDir,
  plan,
  brief,
});
```

And insert, immediately after the `</div>` that closes `.lc-feed` and before `<div className="lc-composer">`:

```tsx
{
  state.pendingPermission && (
    <div className="lc-perm">
      <div className="lc-perm-q">
        Claude wants to use <b>{state.pendingPermission.tool}</b>
      </div>
      <pre className="lc-perm-in">
        {JSON.stringify(state.pendingPermission.input, null, 2).slice(0, 400)}
      </pre>
      <div className="lc-perm-btns">
        <button
          className="lc-allow"
          onClick={() => decide(state.pendingPermission!.requestId, 'allow')}
        >
          Allow
        </button>
        <button
          className="lc-deny"
          onClick={() => decide(state.pendingPermission!.requestId, 'deny')}
        >
          Deny
        </button>
      </div>
    </div>
  );
}
```

Also add an `awaiting-permission` note to the status line block (next to the `running`/`error`/`ended` lines):

```tsx
{
  state.status === 'awaiting-permission' && (
    <div className="lc-status">Waiting for your Allow / Deny…</div>
  );
}
```

- [ ] **Step 6: Styles**

Append to `app/globals.css`:

```css
.lc-perm {
  margin-top: 8px;
  padding: 10px 12px;
  border: 1px solid #e0b3ff;
  background: #faf0ff;
  border-radius: 12px;
}
.lc-perm-q {
  margin-bottom: 6px;
}
.lc-perm-in {
  max-height: 120px;
  overflow: auto;
  background: #fff;
  border-radius: 8px;
  padding: 8px;
  font-size: 12px;
  margin: 0 0 8px;
}
.lc-perm-btns {
  display: flex;
  gap: 8px;
}
.lc-allow,
.lc-deny {
  padding: 6px 16px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
}
.lc-allow {
  background: #2ecc71;
  color: #fff;
}
.lc-deny {
  background: #e74c3c;
  color: #fff;
}
```

- [ ] **Step 7: Typecheck + commit**

Run: `npm run typecheck` → clean.

```bash
git add lib/liveSession/useLiveSession.ts lib/liveSession/transcriptFromLines.test.ts components/views/build/LiveChat.tsx app/globals.css
git commit -m "feat(live-session): Allow/Deny permission card in the DURING chat"
```

---

### Task 6: Verification + wire the permission-server test into CI

**Files:**

- Modify: `package.json` (broaden `test:installer` to include `lib/liveSession/`)

- [ ] **Step 1: Include the .mjs permission-server test in the node --test glob**

In `package.json`, change `test:installer`:

```json
    "test:installer": "node --test lib/installer/ toolkit/hooks/ lib/liveSession/"
```

Run: `npm run test:installer` → PASS (installer + hooks + `permissionServer.test.mjs`).

- [ ] **Step 2: Full suite** — Run: `npm test` → PASS (all vitest, incl. permission routes + reducer).
- [ ] **Step 3: Types + lint + format** — Run: `npm run typecheck && npm run lint` → no type errors, 0 lint errors. `npm run format:check` — prettier-write any tracked file it flags.
- [ ] **Step 4: End-to-end (real `claude`) — the live-validation the caveat calls for.**
      `npm run dev` (ensure `CODEPET_API_URL` matches the dev origin, e.g. `http://127.0.0.1:3000`). Let's build → plan → pick a real repo → Start. Prompt something that needs a command (e.g. "run the tests"). Confirm: an Allow/Deny card appears with the tool + input; clicking **Allow** lets Claude run it (tool activity follows); a fresh request + **Deny** makes Claude skip/adapt. Confirm no tool runs without a card (i.e. `acceptEdits` is truly gone). If the CLI↔MCP handshake differs from the inferred contract, adjust `permissionServer.mjs` (JSON-RPC shapes) and `CLAUDE_ARGS`/`writeMcpConfig` — the pure mappers and routes should not need changes.

---

## Self-Review

**Spec coverage (Phase 3 scope):**

- Allow/Deny in the UI drives the real session → Tasks 2,4,5. ✓
- Replace `acceptEdits` with the prompt-tool bridge → Task 2 (`CLAUDE_ARGS` + flags). ✓
- MCP bridge server, fail-safe deny → Task 3. ✓
- `permission-request` event + `pendingPermission` + `awaiting-permission` → Task 1. ✓
- enqueue parks + holds; resolve via `/permission`; auto-deny timeout → Tasks 2,4. ✓
- Local-only routes → Task 4. ✓

**Placeholder scan:** none — every code step is complete. The one inherently non-unit-testable piece (the live CLI handshake) is explicitly Task 6 Step 4 with a documented adjustment path.

**Type consistency:** `permission-request` union member (Task 1) used by engine emit (Task 2), reducer (Task 1), and `applyDecision` (Task 5); `PermissionDecision` shape consistent registry/engine/routes (Tasks 2,4); `enqueuePermission`/`resolvePermission` signatures consistent Tasks 2/4; `pendingPermission` shape consistent Tasks 1/5; hook returns `{ state, start, stop, send, decide }` (Task 5).

**Caveat restated:** the CLI↔MCP contract (`permissionServer.mjs` JSON-RPC + `writeMcpConfig` + the `--permission-prompt-tool`/`--mcp-config` flags) is best-known/inferred and validated only at Task 6 Step 4; isolated so a live mismatch is a localized fix.
