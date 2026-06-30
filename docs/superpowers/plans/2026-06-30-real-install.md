# Real Install (v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "First install" really copy bundled Claude Code skill/agent files into `~/.claude` via Next.js server actions when running locally, with a copy-paste command fallback when running remote/hosted.

**Architecture:** A Next-free installer core (`lib/installer/*.mjs`) does all filesystem work and is unit-tested with `node:test`. Server actions (`app/actions/install.ts`) and a CLI (`scripts/install-toolkit.mjs`) both wrap that core. The client `InstallView` calls only the server actions and renders their real results; it never imports the installer core directly.

**Tech Stack:** Next.js 16 (App Router, server actions), React 19, TypeScript, plain `.mjs` for the installer core, `node:test` for tests. No new dependencies.

## Global Constraints

- Node 20.20; **no new runtime dependencies**. Tests use the built-in `node --test`.
- The installer core lives in `lib/installer/*.mjs` (plain JS + JSDoc), imports **no** Next/React. Client components import **only** the server actions from `app/actions/install.ts` — never `lib/installer/*` directly (it uses `node:fs`/`node:os`).
- Security boundary: the client sends **only `id` strings**, re-validated server-side by `validateIds` against the manifest allowlist (`^[a-z0-9-]+$` and must exist). Never accept paths or file content from the client.
- Writes are confined to `<claudeDir>/skills/<id>/SKILL.md` and `<claudeDir>/agents/<id>.md`. Uninstall removes only those managed targets. Nothing else is read-modified or deleted.
- `resolveClaudeDir(env)` returns `env.CODEPET_CLAUDE_DIR` if set, else `path.join(os.homedir(), '.claude')`. (The override keeps tests and verification off the real `~/.claude`.)
- Capability is `remote` when `CODEPET_REMOTE === '1'`, or `VERCEL` is set, or there is no home dir; otherwise `local`. Remote refuses to write and shows a command instead.
- v1 scope only: skill + agent files. No `settings.json`/hooks/statusline writes. Connectors and statusline/hook chips stay decorative.
- Match the existing warm design tokens (`--accent`, `--surface`, `--t-1`, `--hairline`, …); reuse the `.ins-*` classes and the bug-fixed `.done` row state. Lowercase "byte".
- Verification: `node --test lib/installer/` (or `yarn test`) for the core; `yarn build` + a headless-browser pass (with `CODEPET_CLAUDE_DIR` pointed at a temp dir) for the UI.

---

### Task 1: Bundled toolkit content + manifest

**Files:**
- Create: `toolkit/manifest.mjs`
- Create: `toolkit/skills/prd-writer/SKILL.md`
- Create: `toolkit/skills/code-review/SKILL.md`
- Create: `toolkit/agents/test-writer.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `toolkit/manifest.mjs` exporting `TOOLKIT` — an array of
  `{ id: string, name: string, type: 'skill'|'agent', source: string, desc: string }`.
  `source` is relative to the `toolkit/` dir. `id` is a kebab-case slug.

- [ ] **Step 1: Create the manifest**

Create `toolkit/manifest.mjs`:

```js
// The bundled, real Claude Code toolkit Codepet installs into ~/.claude.
// `id` is a kebab-case slug; `source` is relative to the repo `toolkit/` dir.
export const TOOLKIT = [
  { id: 'prd-writer',  name: 'PRD writer',  type: 'skill', source: 'skills/prd-writer/SKILL.md',  desc: 'Turn a rough idea into a structured product spec.' },
  { id: 'code-review', name: 'Code review', type: 'skill', source: 'skills/code-review/SKILL.md', desc: 'Review a diff for bugs before it ships.' },
  { id: 'test-writer', name: 'Test Writer', type: 'agent', source: 'agents/test-writer.md',        desc: 'A subagent that writes tests for new code.' },
];
```

- [ ] **Step 2: Create the PRD writer skill**

Create `toolkit/skills/prd-writer/SKILL.md`:

```markdown
---
name: prd-writer
description: Use when turning a rough product idea into a structured PRD — clarifies the user, the problem, scope, and success criteria before any code.
---

# PRD Writer

Turn a rough idea into a short, structured product requirements doc.

## Process
1. Identify the user and the job they're hiring this for.
2. State the problem in one sentence.
3. List in-scope requirements and explicit non-goals (YAGNI).
4. Define success criteria — how you'll know it's done.
5. Note open questions and risks.

Keep it to one page. Prefer bullet points over prose.
```

- [ ] **Step 3: Create the Code review skill**

Create `toolkit/skills/code-review/SKILL.md`:

```markdown
---
name: code-review
description: Use when reviewing a diff before it ships — checks correctness, edge cases, and clarity, and reports findings by severity.
---

# Code Review

Review the current diff for correctness and clarity.

## Checklist
- Correctness: does it do what the change intends? Off-by-one, null/empty, error paths.
- Edge cases: boundary inputs, concurrency, failure modes.
- Clarity: names match behavior; no dead code; no accidental scope creep.

Report findings grouped as Critical / Important / Minor, each with a file:line and a one-line fix.
```

- [ ] **Step 4: Create the Test Writer agent**

Create `toolkit/agents/test-writer.md`:

```markdown
---
name: test-writer
description: Writes focused tests for new or changed code. Use proactively after implementing a feature or fixing a bug.
---

You are a test-writing specialist. Given a change, write the smallest set of tests that verify its real behavior — not mocks.

Guidelines:
- Cover the happy path plus the edge cases that matter (empty, boundary, error).
- One behavior per test; clear names that describe the behavior.
- Match the project's existing test framework and style.
- Make tests deterministic; no reliance on timing or external state.

Output only the test code and where it should live.
```

- [ ] **Step 5: Verify the manifest loads and sources exist**

Run:
```bash
node -e "import('./toolkit/manifest.mjs').then(m=>{const fs=require('fs');for(const i of m.TOOLKIT){if(!fs.existsSync('toolkit/'+i.source))throw new Error('missing '+i.source);}console.log('OK',m.TOOLKIT.length,'items, all sources present');})"
```
Expected: `OK 3 items, all sources present`

- [ ] **Step 6: Commit**

```bash
git add toolkit/
git commit -m "feat: bundle real toolkit (skills + agent) and manifest

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Installer core + tests + test script

**Files:**
- Create: `lib/installer/manifest.mjs`
- Create: `lib/installer/paths.mjs`
- Create: `lib/installer/capability.mjs`
- Create: `lib/installer/install.mjs`
- Create: `lib/installer/install.test.mjs`
- Create: `lib/installer/capability.test.mjs`
- Modify: `package.json` (add `"test"` script)

**Interfaces:**
- Consumes: `TOOLKIT` from `toolkit/manifest.mjs` (Task 1).
- Produces (imported by Tasks 3 & 4):
  - `manifest.mjs`: `TOOLKIT`, `ALL_IDS: string[]`, `itemsByIds(ids: string[])` (throws on unknown), `validateIds(ids: unknown) => string[]` (throws on unknown/malformed).
  - `paths.mjs`: `resolveClaudeDir(env?)`, `targetPath(item, claudeDir)`, `managedTarget(item, claudeDir) => {kind:'dir'|'file', path}`, `sourcePath(item, cwd?)`.
  - `capability.mjs`: `detectCapability(env?, getHome?) => {mode:'local'|'remote', reason}`, `buildInstallCommand(ids: string[]) => string`.
  - `install.mjs`: `installItems(ids, claudeDir) => {id,name,type,target,status:'created'|'updated'|'skipped'|'error',error?}[]`, `uninstallItems(ids, claudeDir) => {id,status:'removed'|'absent'|'error',error?}[]`, `installedStatus(ids, claudeDir) => {id,installed,target}[]`.

- [ ] **Step 1: Write the manifest helper module**

Create `lib/installer/manifest.mjs`:

```js
import { TOOLKIT } from '../../toolkit/manifest.mjs';
export { TOOLKIT };

const SLUG = /^[a-z0-9-]+$/;
export const ALL_IDS = TOOLKIT.map((x) => x.id);

/** @param {string[]} ids */
export function itemsByIds(ids) {
  return ids.map((id) => {
    const item = TOOLKIT.find((x) => x.id === id);
    if (!item) throw new Error(`Unknown toolkit id: ${id}`);
    return item;
  });
}

/** Security boundary: accept only known, well-formed ids. @param {unknown} ids @returns {string[]} */
export function validateIds(ids) {
  if (!Array.isArray(ids)) throw new Error('ids must be an array');
  const known = new Set(ALL_IDS);
  return ids.map((id) => {
    if (typeof id !== 'string' || !SLUG.test(id) || !known.has(id)) {
      throw new Error(`Invalid toolkit id: ${String(id)}`);
    }
    return id;
  });
}
```

- [ ] **Step 2: Write the paths module**

Create `lib/installer/paths.mjs`:

```js
import os from 'node:os';
import path from 'node:path';

/** Resolve the Claude config dir. Honors CODEPET_CLAUDE_DIR (tests/CLI/verification). */
export function resolveClaudeDir(env = process.env) {
  if (env.CODEPET_CLAUDE_DIR) return env.CODEPET_CLAUDE_DIR;
  return path.join(os.homedir(), '.claude');
}

/** Destination path for an item, derived — never from the client. */
export function targetPath(item, claudeDir) {
  if (item.type === 'skill') return path.join(claudeDir, 'skills', item.id, 'SKILL.md');
  if (item.type === 'agent') return path.join(claudeDir, 'agents', `${item.id}.md`);
  throw new Error(`Unknown item type: ${item.type}`);
}

/** The managed target to remove on uninstall (dir for skills, file for agents). */
export function managedTarget(item, claudeDir) {
  if (item.type === 'skill') return { kind: 'dir',  path: path.join(claudeDir, 'skills', item.id) };
  if (item.type === 'agent') return { kind: 'file', path: path.join(claudeDir, 'agents', `${item.id}.md`) };
  throw new Error(`Unknown item type: ${item.type}`);
}

/** Source path in the repo toolkit dir. */
export function sourcePath(item, cwd = process.cwd()) {
  return path.join(cwd, 'toolkit', item.source);
}
```

- [ ] **Step 3: Write the capability module**

Create `lib/installer/capability.mjs`:

```js
import os from 'node:os';

/** Decide whether this server can install onto the user's machine. */
export function detectCapability(env = process.env, getHome = () => { try { return os.homedir(); } catch { return ''; } }) {
  if (env.CODEPET_REMOTE === '1') return { mode: 'remote', reason: 'CODEPET_REMOTE' };
  if (env.VERCEL) return { mode: 'remote', reason: 'VERCEL' };
  const home = env.CODEPET_CLAUDE_DIR || getHome();
  if (!home) return { mode: 'remote', reason: 'no-home' };
  return { mode: 'local', reason: 'local' };
}

/** Fallback command shown when remote — run from a cloned Codepet repo. */
export function buildInstallCommand(ids) {
  return `node scripts/install-toolkit.mjs ${ids.join(' ')}`;
}
```

- [ ] **Step 4: Write the install module**

Create `lib/installer/install.mjs`:

```js
import fs from 'node:fs';
import path from 'node:path';
import { itemsByIds } from './manifest.mjs';
import { targetPath, managedTarget, sourcePath } from './paths.mjs';

/** Install items into claudeDir. @returns {{id,name,type,target,status,error?}[]} */
export function installItems(ids, claudeDir) {
  return itemsByIds(ids).map((item) => {
    const target = targetPath(item, claudeDir);
    const base = { id: item.id, name: item.name, type: item.type, target };
    try {
      const src = fs.readFileSync(sourcePath(item), 'utf8');
      let status;
      if (fs.existsSync(target)) {
        status = fs.readFileSync(target, 'utf8') === src ? 'skipped' : 'updated';
      } else {
        status = 'created';
      }
      if (status !== 'skipped') {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, src);
      }
      return { ...base, status };
    } catch (e) {
      return { ...base, status: 'error', error: e instanceof Error ? e.message : String(e) };
    }
  });
}

/** Remove the managed target for each item. @returns {{id,status,error?}[]} */
export function uninstallItems(ids, claudeDir) {
  return itemsByIds(ids).map((item) => {
    const { kind, path: p } = managedTarget(item, claudeDir);
    try {
      if (!fs.existsSync(p)) return { id: item.id, status: 'absent' };
      fs.rmSync(p, kind === 'dir' ? { recursive: true, force: true } : { force: true });
      return { id: item.id, status: 'removed' };
    } catch (e) {
      return { id: item.id, status: 'error', error: e instanceof Error ? e.message : String(e) };
    }
  });
}

/** Existence status for each item. @returns {{id,installed,target}[]} */
export function installedStatus(ids, claudeDir) {
  return itemsByIds(ids).map((item) => {
    const target = targetPath(item, claudeDir);
    return { id: item.id, installed: fs.existsSync(target), target };
  });
}
```

- [ ] **Step 5: Write the failing tests**

Create `lib/installer/install.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installItems, uninstallItems, installedStatus } from './install.mjs';
import { validateIds, itemsByIds } from './manifest.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'codepet-claude-'));

test('installItems creates skill and agent files at derived paths', () => {
  const dir = tmp();
  const res = installItems(['prd-writer', 'test-writer'], dir);
  assert.equal(res[0].status, 'created');
  assert.equal(res[1].status, 'created');
  assert.ok(fs.existsSync(path.join(dir, 'skills', 'prd-writer', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(dir, 'agents', 'test-writer.md')));
});

test('installItems is idempotent (skipped on identical re-run)', () => {
  const dir = tmp();
  installItems(['prd-writer'], dir);
  assert.equal(installItems(['prd-writer'], dir)[0].status, 'skipped');
});

test('installItems reports updated when the target differs', () => {
  const dir = tmp();
  installItems(['prd-writer'], dir);
  fs.writeFileSync(path.join(dir, 'skills', 'prd-writer', 'SKILL.md'), 'changed');
  assert.equal(installItems(['prd-writer'], dir)[0].status, 'updated');
});

test('installedStatus reflects before/after install', () => {
  const dir = tmp();
  assert.equal(installedStatus(['code-review'], dir)[0].installed, false);
  installItems(['code-review'], dir);
  assert.equal(installedStatus(['code-review'], dir)[0].installed, true);
});

test('uninstallItems removes managed targets, then reports absent', () => {
  const dir = tmp();
  installItems(['prd-writer'], dir);
  assert.equal(uninstallItems(['prd-writer'], dir)[0].status, 'removed');
  assert.equal(fs.existsSync(path.join(dir, 'skills', 'prd-writer')), false);
  assert.equal(uninstallItems(['prd-writer'], dir)[0].status, 'absent');
});

test('itemsByIds throws on unknown id', () => {
  assert.throws(() => itemsByIds(['nope']), /Unknown toolkit id/);
});

test('validateIds rejects malformed or unknown ids, accepts known', () => {
  assert.throws(() => validateIds(['../etc']), /Invalid toolkit id/);
  assert.throws(() => validateIds(['unknown-skill']), /Invalid toolkit id/);
  assert.deepEqual(validateIds(['prd-writer']), ['prd-writer']);
});
```

Create `lib/installer/capability.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCapability, buildInstallCommand } from './capability.mjs';

test('local by default', () => {
  assert.equal(detectCapability({}, () => '/home/u').mode, 'local');
});
test('remote for CODEPET_REMOTE=1', () => {
  assert.equal(detectCapability({ CODEPET_REMOTE: '1' }, () => '/home/u').mode, 'remote');
});
test('remote for VERCEL', () => {
  assert.equal(detectCapability({ VERCEL: '1' }, () => '/home/u').mode, 'remote');
});
test('remote when there is no home dir', () => {
  assert.equal(detectCapability({}, () => '').mode, 'remote');
});
test('buildInstallCommand emits the CLI line', () => {
  assert.equal(buildInstallCommand(['prd-writer', 'code-review']), 'node scripts/install-toolkit.mjs prd-writer code-review');
});
```

- [ ] **Step 6: Add the test script and run the tests**

In `package.json`, add to `"scripts"` (after `"lint": "next lint"`):

```json
    "test": "node --test lib/installer/"
```

Run: `yarn test`
Expected: all tests pass — output ends with `# pass 12`, `# fail 0` (7 install + 5 capability).

- [ ] **Step 7: Commit**

```bash
git add lib/installer/ package.json
git commit -m "feat: installer core (skills/agents copy) with node:test coverage

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Server actions

**Files:**
- Create: `app/actions/install.ts`

**Interfaces:**
- Consumes: `lib/installer/*` (Task 2).
- Produces (called by `InstallView`, Task 5), all async:
  - `getCapability() => {mode,reason}`
  - `getToolkit() => TOOLKIT`
  - `getStatus() => {id,installed,target}[]`
  - `installToolkit(ids: string[]) => {ok:true, results:Result[]} | {ok:false, reason:'remote'}`
  - `uninstallToolkit(ids: string[]) => {id,status,error?}[]`
  - `getInstallCommand(ids: string[]) => string`

- [ ] **Step 1: Create the server actions**

Create `app/actions/install.ts`:

```ts
'use server';
import { detectCapability, buildInstallCommand } from '@/lib/installer/capability.mjs';
import { resolveClaudeDir } from '@/lib/installer/paths.mjs';
import { installItems, uninstallItems, installedStatus } from '@/lib/installer/install.mjs';
import { TOOLKIT, ALL_IDS, validateIds } from '@/lib/installer/manifest.mjs';

export async function getCapability() {
  return detectCapability(process.env);
}

export async function getToolkit() {
  return TOOLKIT;
}

export async function getStatus() {
  return installedStatus(ALL_IDS, resolveClaudeDir());
}

export async function installToolkit(ids: string[]) {
  if (detectCapability(process.env).mode === 'remote') {
    return { ok: false as const, reason: 'remote' as const };
  }
  return { ok: true as const, results: installItems(validateIds(ids), resolveClaudeDir()) };
}

export async function uninstallToolkit(ids: string[]) {
  return uninstallItems(validateIds(ids), resolveClaudeDir());
}

export async function getInstallCommand(ids: string[]) {
  return buildInstallCommand(validateIds(ids));
}
```

- [ ] **Step 2: Verify it builds (typecheck + compile)**

Run: `yarn build`
Expected: build succeeds, no TypeScript errors. (If the build complains that importing `.mjs` needs a default/missing type, it is a real error — confirm the `@/lib/installer/*.mjs` paths and `.mjs` extensions are exact.)

- [ ] **Step 3: Commit**

```bash
git add app/actions/install.ts
git commit -m "feat: server actions wrapping the installer core

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: CLI wrapper (fallback / paste command)

**Files:**
- Create: `scripts/install-toolkit.mjs`

**Interfaces:**
- Consumes: `lib/installer/install.mjs`, `lib/installer/paths.mjs`, `lib/installer/manifest.mjs` (Task 2).
- Produces: a CLI invoked as `node scripts/install-toolkit.mjs <id…>` (no args = all ids). This is exactly the string `buildInstallCommand` emits.

- [ ] **Step 1: Create the CLI**

Create `scripts/install-toolkit.mjs`:

```js
#!/usr/bin/env node
import { installItems } from '../lib/installer/install.mjs';
import { resolveClaudeDir } from '../lib/installer/paths.mjs';
import { validateIds, ALL_IDS } from '../lib/installer/manifest.mjs';

const args = process.argv.slice(2);
let valid;
try {
  valid = validateIds(args.length ? args : ALL_IDS);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(2);
}

const claudeDir = resolveClaudeDir();
const results = installItems(valid, claudeDir);
for (const r of results) {
  const mark = r.status === 'error' ? '✗' : '✓';
  const detail = r.status === 'error' ? `ERROR: ${r.error}` : r.status;
  console.log(`${mark} ${r.name} [${r.type}] → ${r.target} (${detail})`);
}
console.log(`\nClaude dir: ${claudeDir}`);
process.exit(results.some((r) => r.status === 'error') ? 1 : 0);
```

- [ ] **Step 2: Verify the CLI installs into a temp dir (keeps real ~/.claude clean)**

Run:
```bash
rm -rf /tmp/codepet-cli && CODEPET_CLAUDE_DIR=/tmp/codepet-cli node scripts/install-toolkit.mjs prd-writer test-writer && \
test -f /tmp/codepet-cli/skills/prd-writer/SKILL.md && test -f /tmp/codepet-cli/agents/test-writer.md && \
echo "CLI OK: files created" && \
CODEPET_CLAUDE_DIR=/tmp/codepet-cli node scripts/install-toolkit.mjs prd-writer | grep -q skipped && echo "CLI OK: idempotent"
```
Expected: prints the two `✓ … (created)` lines, then `CLI OK: files created`, then `CLI OK: idempotent`.

- [ ] **Step 3: Commit**

```bash
git add scripts/install-toolkit.mjs
git commit -m "feat: install-toolkit CLI for the paste/fallback path

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Rewire InstallView to the real installer (+ store, CSS)

**Files:**
- Modify: `lib/store.tsx` (replace `markInstalled` with `setInstalled`)
- Modify: `components/views/InstallView.tsx` (full rewrite of the data layer)
- Modify: `app/globals.css` (add `.ins-cmd*` and `.ins-row.err` rules)

**Interfaces:**
- Consumes: the server actions from `app/actions/install.ts` (Task 3); `useApp()` from the store.
- Produces: the working install view (local: real per-item report + uninstall; remote: copy command).

- [ ] **Step 1: Replace `markInstalled` with `setInstalled` in the store**

In `lib/store.tsx`:

In the `AppState` interface, replace the line `markInstalled: () => void;` with:

```tsx
  setInstalled: (value: boolean) => void;
```

Replace the `markInstalled` callback definition:

```tsx
  const markInstalled = useCallback(() => {
    setInstalled(true);
    try { localStorage.setItem('codepet:installed', '1'); } catch {}
  }, []);
```

with:

```tsx
  const setInstalledFlag = useCallback((value: boolean) => {
    setInstalled(value);
    try {
      if (value) localStorage.setItem('codepet:installed', '1');
      else localStorage.removeItem('codepet:installed');
    } catch {}
  }, []);
```

(The `const [installed, setInstalled] = useState(false);` state line stays as-is — `setInstalledFlag` wraps the raw setter.)

In the `value = useMemo<AppState>(() => ({ ... }))` object, replace `markInstalled,` with `setInstalled: setInstalledFlag,`. In the `useMemo` dependency array, replace `markInstalled` with `setInstalledFlag`.

- [ ] **Step 2: Rewrite InstallView**

Replace the entire contents of `components/views/InstallView.tsx` with:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useApp } from '@/lib/store';
import { Byte } from '../Byte';
import {
  getCapability, getToolkit, getStatus,
  installToolkit, uninstallToolkit, getInstallCommand,
} from '@/app/actions/install';

type Cap = { mode: 'local' | 'remote'; reason: string };
type Item = { id: string; name: string; type: 'skill' | 'agent'; source: string; desc: string };
type Status = { id: string; installed: boolean; target: string };
type Result = { id: string; name: string; type: string; target: string; status: string; error?: string };

export function InstallView() {
  const { setInstalled, show } = useApp();
  const [cap, setCap] = useState<Cap | null>(null);
  const [toolkit, setToolkit] = useState<Item[]>([]);
  const [status, setStatus] = useState<Status[]>([]);
  const [results, setResults] = useState<Result[] | null>(null);
  const [cmd, setCmd] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = async () => {
    const [c, t, s] = await Promise.all([getCapability(), getToolkit(), getStatus()]);
    setCap(c); setToolkit(t); setStatus(s);
    setInstalled(s.some((x) => x.installed));
    if (c.mode === 'remote') setCmd(await getInstallCommand(t.map((i) => i.id)));
  };
  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ids = toolkit.map((i) => i.id);
  const installedSet = new Set(status.filter((s) => s.installed).map((s) => s.id));
  const allInstalled = toolkit.length > 0 && ids.every((id) => installedSet.has(id));

  const run = async () => {
    setBusy(true);
    const res = await installToolkit(ids);
    if (res.ok) setResults(res.results);
    await refresh();
    setBusy(false);
  };
  const remove = async () => {
    setBusy(true);
    await uninstallToolkit(ids);
    setResults(null);
    await refresh();
    setBusy(false);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };

  const statusClass = (s: string) => (s === 'error' ? ' err' : ' done');
  const statusIcon = (s: string) => (s === 'error' ? '✗' : '✓');

  return (
    <section className="view on" id="v-install">
      <div className="vhead">
        <h1>{allInstalled ? 'byte is ready' : "Let's wake byte up"}</h1>
        <div className="sub">
          {cap?.mode === 'remote'
            ? "Hosted preview — copy the command below to install byte's toolkit on your machine."
            : "One click installs byte's toolkit into ~/.claude on this machine."}
        </div>
      </div>
      <div className="install">
        <div className="ins-hero">
          <Byte size="s56" className={allInstalled ? 'cheer' : ''} />
          <div className="ins-h-txt">
            <b>{allInstalled ? "byte's awake! 🎉" : "Hi, I'm byte 🐣"}</b>
            <span>
              {allInstalled
                ? `${installedSet.size} item${installedSet.size === 1 ? '' : 's'} installed in ~/.claude`
                : "I'll set up real skills + agents you can use right away"}
            </span>
          </div>
        </div>

        {cap === null && <div className="ins-row on"><span className="ins-ic">○</span><div className="ins-meta"><b>Checking your environment…</b></div></div>}

        {cap?.mode === 'local' && (
          <>
            {!allInstalled
              ? <button className="ins-btn" disabled={busy} onClick={run}>{busy ? 'Installing…' : '▶ Wake byte up'}</button>
              : <button className="ins-btn" disabled={busy} onClick={remove}>{busy ? 'Removing…' : 'Uninstall toolkit'}</button>}

            {(results ?? toolkit.map((i) => ({ id: i.id, name: i.name, type: i.type, target: '', status: installedSet.has(i.id) ? 'installed' : 'pending' } as Result))).map((r) => (
              <div className={`ins-row on${r.status === 'pending' ? '' : statusClass(r.status)}`} key={r.id}>
                <span className="ins-ic">{r.status === 'pending' ? '○' : statusIcon(r.status)}</span>
                <div className="ins-meta">
                  <b>{r.name} <span className="ins-kind">{r.type}</span></b>
                  <span>{r.status === 'error' ? r.error : (r.target || `will install to ~/.claude/${r.type === 'skill' ? 'skills' : 'agents'}`)}</span>
                </div>
                {r.status !== 'pending' && <span className={`ins-tag${r.status === 'error' ? ' err' : ''}`}>{r.status}</span>}
              </div>
            ))}
          </>
        )}

        {cap?.mode === 'remote' && (
          <div className="ins-cmd">
            <div className="ins-cmd-h">Run this from your Codepet repo to install byte's toolkit:</div>
            <div className="ins-cmd-box"><code>{cmd}</code><button className="ins-cmd-copy" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button></div>
          </div>
        )}

        <div className="ins-opt-h">Set up later — no rush</div>
        <div className="ins-pack on">
          <div className="ins-pk-h">optional extras ✨</div>
          <div className="ins-chips">
            <span className="ins-chip c">statusline: tokens</span>
            <span className="ins-chip c">hook: session-start</span>
            <span className="ins-chip">connector: GitHub</span>
            <span className="ins-chip">connector: Notion</span>
          </div>
        </div>

        <button className="ins-skip" onClick={() => show('env')}>Skip → see the full Environment</button>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Add the CSS for the command block, error rows, and kind tag**

In `app/globals.css`, append after the existing `.ins-link:hover` rule (end of the install block):

```css
  .ins-kind{font-family:var(--pixel);font-size:8px;letter-spacing:.4px;text-transform:uppercase;color:var(--t-4);background:var(--well);border:1px solid var(--hairline);border-radius:5px;padding:1px 5px;vertical-align:middle;margin-left:6px}
  .ins-row.err{border-color:var(--clay-line);background:var(--clay-tint)}
  .ins-row.err .ins-ic{color:var(--clay)}
  .ins-tag.err{background:var(--clay-tint);color:var(--clay)}
  .ins-cmd{margin-bottom:9px}
  .ins-cmd-h{font-size:12.5px;color:var(--t-3);margin-bottom:8px}
  .ins-cmd-box{display:flex;align-items:center;gap:10px;background:#1F1B15;border:1px solid var(--hairline);border-radius:10px;padding:11px 13px}
  .ins-cmd-box code{flex:1;font-family:var(--mono,monospace);font-size:12.5px;color:#E7ECF2;overflow-x:auto;white-space:nowrap}
  .ins-cmd-copy{flex:none;font-size:12px;font-weight:600;border:1px solid var(--accent-line);background:var(--surface);color:var(--accent-deep);border-radius:8px;padding:6px 13px;cursor:pointer}
  .ins-cmd-copy:hover{background:var(--accent);border-color:var(--accent);color:#fff}
```

(If `--clay-line`/`--clay-tint`/`--clay`/`--mono` are absent, confirm they exist in `:root`; the codebase defines `--clay`, `--clay-tint`, `--clay-line`. Use `monospace` if `--mono` is undefined.)

- [ ] **Step 4: Verify it builds**

Run: `yarn build`
Expected: build succeeds, no TypeScript errors.

- [ ] **Step 5: Headless verification of the local flow (writes to a TEMP claude dir, not real ~/.claude)**

Start a throwaway dev server pointed at a temp claude dir on a spare port, then drive it:

```bash
rm -rf /tmp/codepet-verify
CODEPET_CLAUDE_DIR=/tmp/codepet-verify yarn next dev -p 3210 >/tmp/codepet-dev.log 2>&1 &
DEV=$!
sleep 6
npm i -D playwright >/dev/null 2>&1; npx playwright install chromium >/dev/null 2>&1
cat > ./_verify_real.mjs <<'JS'
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 1200 } });
await p.goto('http://localhost:3210/', { waitUntil: 'networkidle' });
try { await p.click('.splash', { timeout: 1500 }); } catch {}
try { await p.click('text=Skip onboarding', { timeout: 2500 }); } catch {}
await p.click('text=First install');
await p.waitForTimeout(500);
await p.click('.ins-btn');                       // Wake byte up
await p.waitForTimeout(1500);
const tags = await p.$$eval('.ins-tag', els => els.map(e => e.textContent));
console.log('RESULT TAGS:', JSON.stringify(tags));
await b.close();
JS
node ./_verify_real.mjs; rm -f ./_verify_real.mjs
echo "--- files written to temp claude dir ---"
ls -R /tmp/codepet-verify
kill $DEV 2>/dev/null
git checkout -- package.json package-lock.json 2>/dev/null
```
Expected: `RESULT TAGS:` lists `created` for each item (3 tags); the `ls -R` shows `/tmp/codepet-verify/skills/prd-writer/SKILL.md`, `/tmp/codepet-verify/skills/code-review/SKILL.md`, `/tmp/codepet-verify/agents/test-writer.md`. Real `~/.claude` is untouched.

- [ ] **Step 6: Commit**

```bash
git add lib/store.tsx components/views/InstallView.tsx app/globals.css
git commit -m "feat: InstallView performs real install via server actions (local) + command fallback

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** bundled toolkit + manifest (Task 1); installer core with capability/install/uninstall/status/validate + tests (Task 2); server actions with the validate security boundary and remote refusal (Task 3); CLI fallback (Task 4); InstallView rewire to real results + remote command + disk-truth status + uninstall, store `setInstalled`, CSS (Task 5). Every spec section maps to a task.
- **No new deps:** core/tests use built-ins; playwright is installed only as a throwaway during Task 5 verification and reverted.
- **Security boundary:** client passes only ids; `validateIds` (tested in Task 2) gates every action; writes confined to derived skill/agent paths.
- **Safe verification:** Tasks 4 & 5 use `CODEPET_CLAUDE_DIR` to keep the real `~/.claude` untouched.
- **Type consistency:** `installItems`/`uninstallItems`/`installedStatus`/`validateIds`/`detectCapability`/`buildInstallCommand`/`resolveClaudeDir` names and shapes are identical across Tasks 2–5; `Result`/`Status`/`Cap`/`Item` in InstallView match the action return shapes.
