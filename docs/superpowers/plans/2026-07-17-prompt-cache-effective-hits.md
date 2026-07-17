# Prompt Caching — Make It Actually Hit (chat + run-task) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `chat` from write-only prompt caching (net cost) to a real per-turn cache hit, and de-fragment `run-task`/`task-help` cross-department hits, via a stable/volatile system split in the client seam.

**Architecture:** Add a `SystemInput = string | { stable; volatile? }` shape to `lib/ai/client.ts`. `cachedSystem` places the `cache_control` breakpoint after the stable block only; the volatile block is billed normally. Routes declare what part of their system is stable; the string path is unchanged so untouched routes have zero churn.

**Tech Stack:** TypeScript, Next.js App Router (Node runtime route handlers), `@anthropic-ai/sdk` ^0.107.0, Vitest.

## Global Constraints

- Package manager / checks: `npx vitest run`, `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .` — all must pass. `eslint .` must exit 0 (the repo tracks a suppressed-warning count in `eslint-suppressions.json`; do not change the count).
- `tsc --noEmit` has two PRE-EXISTING unrelated errors (`firestore.rules.test.ts` missing `@firebase/rules-unit-testing`, `lib/build/cloudSandbox.ts` missing `e2b`). These are not caused by this work; ignore only these two.
- Vitest has NO `@/` path alias — test files use relative imports (e.g. `./client`).
- The cache marker constant is `CACHE: Anthropic.CacheControlEphemeral = { type: 'ephemeral' }` (already in `client.ts`).
- **Behavioral invariant:** for every route changed, `stable + volatile` must equal the OLD system string byte-for-byte. Only the cache breakpoint moves; byte's prompt content must not change.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Branch: `feat/prompt-cache-effective` (already created off `origin/develop`).

---

### Task 1: Client seam — stable/volatile split in `cachedSystem`

**Files:**

- Modify: `lib/ai/client.ts` (add `SystemInput` type ~line 146; export + rewrite `cachedSystem` at lines 148-150; widen `GenerateOptions.system` at line 174 and `StreamOptions.system` at line 248 from `string` to `SystemInput`)
- Test: `lib/ai/client.test.ts` (add a `describe('cachedSystem', …)` block)

**Interfaces:**

- Produces: `export type SystemInput = string | { stable: string; volatile?: string }`
- Produces: `export function cachedSystem(system: SystemInput): Anthropic.TextBlockParam[]`
- Consumes: existing module-private `const CACHE: Anthropic.CacheControlEphemeral = { type: 'ephemeral' }`

- [ ] **Step 1: Write the failing tests**

Append to `lib/ai/client.test.ts`. Also add `cachedSystem` to the existing import on line 2 (`import { classifyFailureKind, errorInfo, errorCodeOf, GenerationError, cachedSystem } from './client';`).

```ts
describe('cachedSystem', () => {
  const CC = { type: 'ephemeral' };

  it('string input → exactly one cached block (backward compat)', () => {
    expect(cachedSystem('hello')).toEqual([{ type: 'text', text: 'hello', cache_control: CC }]);
  });

  it('{stable, volatile} → stable cached first, volatile uncached second, in order', () => {
    const blocks = cachedSystem({ stable: 'S', volatile: 'V' });
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: 'text', text: 'S', cache_control: CC });
    expect(blocks[1]).toEqual({ type: 'text', text: 'V' });
    expect(blocks[1].cache_control).toBeUndefined();
  });

  it('{stable} with absent or empty volatile → one cached block, no empty trailing block', () => {
    const expected = [{ type: 'text', text: 'S', cache_control: CC }];
    expect(cachedSystem({ stable: 'S' })).toEqual(expected);
    expect(cachedSystem({ stable: 'S', volatile: '' })).toEqual(expected);
  });

  it('passes stable/volatile text through unmodified (byte-identical prefix preserved)', () => {
    const stable = '  leading and trailing whitespace kept  ';
    const blocks = cachedSystem({ stable, volatile: 'x' });
    expect(blocks[0].text).toBe(stable);
    expect(blocks[1].text).toBe('x');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd <worktree> && npx vitest run lib/ai/client.test.ts`
Expected: FAIL — `cachedSystem` is not exported (import resolves to `undefined`, calling it throws / assertions fail).

- [ ] **Step 3: Implement the split in `lib/ai/client.ts`**

Replace the existing `cachedSystem` (lines 148-150):

```ts
function cachedSystem(system: string): Anthropic.TextBlockParam[] {
  return [{ type: 'text', text: system, cache_control: CACHE }];
}
```

with:

```ts
/** A route's system prompt. A plain string is cached whole (one breakpoint at its end). An
 *  object splits it: only `stable` is marked cacheable, so the breakpoint lands after it and
 *  the per-request `volatile` half is billed normally — the way to make a route with dynamic
 *  grounding still get a cache HIT on its stable prefix. */
export type SystemInput = string | { stable: string; volatile?: string };

export function cachedSystem(system: SystemInput): Anthropic.TextBlockParam[] {
  if (typeof system === 'string') {
    return [{ type: 'text', text: system, cache_control: CACHE }];
  }
  const blocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: system.stable, cache_control: CACHE },
  ];
  if (system.volatile) blocks.push({ type: 'text', text: system.volatile });
  return blocks;
}
```

Then widen the two option types so routes can pass either shape:

- `GenerateOptions.system` (line 174): change `system: string;` → `system: SystemInput;`
- `StreamOptions.system` (line 248): change `system: string;` → `system: SystemInput;`

No other change is needed — `generateText` (line 204) and `streamMessage` (line 272) already call `cachedSystem(opts.system)`, which now accepts both shapes.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/ai/client.test.ts`
Expected: PASS (all cachedSystem cases + the existing error-handling cases).

- [ ] **Step 5: Typecheck (the widening must not break any existing string call site)**

Run: `npx tsc --noEmit 2>&1 | grep -v "firestore.rules.test.ts\|cloudSandbox.ts\|@firebase/rules-unit-testing\|module 'e2b'"`
Expected: no output (only the two pre-existing unrelated errors are filtered out).

- [ ] **Step 6: Commit**

```bash
git add lib/ai/client.ts lib/ai/client.test.ts
git commit -m "feat(ai): stable/volatile system split for effective prompt caching

cachedSystem now accepts { stable, volatile } and places the cache breakpoint
after the stable block only, so a route with dynamic grounding gets a real
cache hit on its stable prefix. String path unchanged (backward compatible).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `chat` route — split the system at the context boundary

**Files:**

- Modify: `app/api/chat/route.ts:336` (the `const system = …` concatenation)

**Interfaces:**

- Consumes: `SystemInput` (Task 1) via the widened `streamMessage` `system` field.

- [ ] **Step 1: Split the system string**

Current (line 336):

```ts
const system = `${BYTE_SYSTEM}\n\nThe founder's company: ${context}${relevantBlock}${secondBrainBlock}${threadSummaryBlock}${deptSummary}${runnableBlock}${setupBlock}${memoryBlock}${deptExpertiseBlock}${personaOverride(companionForDept(focusDeptKey).id)}`;
```

Replace with (stable = BYTE_SYSTEM + company context; volatile = everything from prior-work on — `stable + volatile` is byte-identical to the old string):

```ts
// Cache the stable prefix (byte's system + the company model) and bill the per-message
// grounding normally. composeProjectModel is deterministic from brief+decisions+shipped, so
// the stable half repeats byte-for-byte across turns that don't change a decision or ship —
// i.e. most turns → a real cache hit. See docs/superpowers/specs/2026-07-17-prompt-cache-effective-hits-design.md.
const system = {
  stable: `${BYTE_SYSTEM}\n\nThe founder's company: ${context}`,
  volatile: `${relevantBlock}${secondBrainBlock}${threadSummaryBlock}${deptSummary}${runnableBlock}${setupBlock}${memoryBlock}${deptExpertiseBlock}${personaOverride(companionForDept(focusDeptKey).id)}`,
};
```

Leave the `streamMessage({ … system, … })` call (line ~339) unchanged — it already passes `system`.

- [ ] **Step 2: Verify the invariant by inspection**

Confirm `stable + volatile` reproduces the old line 336 template exactly: `BYTE_SYSTEM` + `"\n\nThe founder's company: "` + `context` (stable), then `relevantBlock` → `personaOverride(...)` (volatile), same order, no characters added or removed.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v "firestore.rules.test.ts\|cloudSandbox.ts\|@firebase/rules-unit-testing\|module 'e2b'"`
Expected: no output.

- [ ] **Step 4: Run the full suite (no regression)**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "feat(chat): cache the stable system prefix (byte system + company model)

Splits chat's system into a cached stable prefix and an uncached volatile
grounding block, converting chat from write-only caching to a real per-turn
hit on ~1.5-2.5k stable tokens. stable+volatile is byte-identical to before.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `run-task` + `task-help` — move persona to volatile

**Files:**

- Modify: `app/api/run-task/route.ts:167`
- Modify: `app/api/task-help/route.ts:145`

**Interfaces:**

- Consumes: `SystemInput` (Task 1) via the widened `generateText`/`generateJson` `system` field.

- [ ] **Step 1: Change both call sites to the split shape**

Both files currently have the identical line:

```ts
const system = composeRunSystem(context) + personaOverride(companionForDept(fields.deptKey).id);
```

Replace it in BOTH files with (stable = `composeRunSystem(context)`; persona → volatile so the stable prefix is identical across departments; `stable + volatile` is byte-identical to before):

```ts
// Persona is per-department; keep it OUT of the cached prefix so consecutive runs in
// different departments still hit the cached stable system (byte system + company model).
const system = {
  stable: composeRunSystem(context),
  volatile: personaOverride(companionForDept(fields.deptKey).id),
};
```

Leave the downstream `generateText`/`generateJson`/`streamMessage` call that consumes `system` unchanged.

- [ ] **Step 2: Verify the invariant by inspection**

In each file, `composeRunSystem(context)` + `personaOverride(...)` (old) equals `stable + volatile` (new) — same two pieces, same order.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v "firestore.rules.test.ts\|cloudSandbox.ts\|@firebase/rules-unit-testing\|module 'e2b'"`
Expected: no output.

- [ ] **Step 4: Run the full suite (no regression)**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/run-task/route.ts app/api/task-help/route.ts
git commit -m "feat(run-task): move persona out of the cached system prefix

run-task and task-help now cache the stable system (byte system + company
model) and keep the per-department persona in the volatile block, so
cross-department deliverable runs hit the cache instead of missing.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Final gate + PR

**Files:** none (verification only)

- [ ] **Step 1: Full check suite**

Run each; all must pass:

```bash
npx prettier --check .
npx eslint . ; echo "eslint exit: $?"    # must be 0
npx tsc --noEmit 2>&1 | grep -v "firestore.rules.test.ts\|cloudSandbox.ts\|@firebase/rules-unit-testing\|module 'e2b'"   # no output
npx vitest run
```

- [ ] **Step 2: Push the branch**

```bash
git push -u origin feat/prompt-cache-effective
```

- [ ] **Step 3: Open the PR to `develop`**

```bash
gh pr create --base develop --head feat/prompt-cache-effective \
  --title "feat(ai): make prompt caching actually hit (chat + run-task)" \
  --body "Implements docs/superpowers/specs/2026-07-17-prompt-cache-effective-hits-design.md.

Splits the system prompt into a cached stable prefix + uncached volatile block in the
client seam. Converts chat from write-only caching (net +25% surcharge, ~0% reads) to a
real per-turn hit on ~1.5-2.5k stable tokens, and de-fragments run-task/task-help so
cross-department runs hit. Backward-compatible: untouched routes keep passing a plain string.

**Verify post-deploy:** on the preview, send two chat turns in one thread and confirm the
2nd turn's \`[ai] label=chat\` log shows \`cache_read > 0\`; confirm run-task shows
\`cache_read > 0\` on a second same-company deliverable across two different departments.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 4: Post-deploy verification note**

Once Vercel builds the preview, exercise chat (2 turns, same thread) and run-task (2 deliverables, different departments, same company) and grep the function logs for `[ai] label=chat` / `label=run-task` lines showing `cache_read > 0` on the second call. This confirms the cache is now HITTING (not just writing). Automated tests cannot assert this — it requires the live Anthropic API.

---

## Self-Review

**Spec coverage:**

- Spec §1 (client seam split) → Task 1. ✅
- Spec §2 (chat stable = BYTE_SYSTEM + context, volatile = rest) → Task 2. ✅
- Spec §3 (run-task/task-help persona → volatile) → Task 3. ✅
- Spec §4 (5-min TTL default) → no code change needed (the default `CACHE = { type: 'ephemeral' }` is already 5-min); no task required. ✅
- Spec Testing (4 cachedSystem cases + post-deploy log check) → Task 1 Step 1 (the four cases) + Task 4 Step 4 (post-deploy). ✅
- Spec "backward compatible, untouched routes unaffected" → Task 1 Step 5 typecheck + string-path test. ✅
- Spec out-of-scope items → intentionally no tasks. ✅

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". All code shown in full. ✅

**Type consistency:** `SystemInput` and `cachedSystem` names/signatures are identical across Task 1 (definition), Task 2, and Task 3 (consumers). `CACHE`/`{ type: 'ephemeral' }` matches the existing constant. ✅
