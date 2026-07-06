# Toolkit Usage Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn each Environment toggle into a receipt — byte names the on-items that fit a task while it runs, and each item shows "Used in N tasks · last: '<task>'."

**Architecture:** One pure module decides who's credited (`toolkitUsedFor`) and feeds both surfaces: the execute log gains "used X" steps, and a per-item `tasks` list (persisted additively as `envUsage`) drives the receipt. Credit lands when byte produces a deliverable of a fitting type, deduped by task title.

**Tech Stack:** Next.js 16 App Router, React, TypeScript, Firebase/Firestore, Vitest (`*.test.ts`, node env).

## Global Constraints

_Every task's requirements implicitly include this section. Copy verbatim into each reviewer dispatch._

- **Honesty:** an item is credited only when it is **on** (`s === 1`) AND a task of a **fitting** deliverable type is produced. Off items and non-fitting tasks never accrue credit or appear in the log. The receipt reflects real in-app run events — it must not imply a live external connection.
- **One source of truth:** `toolkitUsedFor(env, type)` decides who's credited; both the execute-log mention and the receipt derive from it so they never disagree.
- **Credit on run (produce), deduped by task title** — "Used in N tasks" = N *distinct* tasks; re-running/revising the same task never inflates it.
- **Persist additively:** usage stores in a NEW `envUsage` field on the company doc — the existing `env` on/off field is untouched (no migration). Persist through the same Firestore channel pattern as `env`.
- **Reduce edit surface:** reuse the existing `buildLog` and the existing produce path (`applyResult` call sites) — no parallel machinery.
- **Do NOT touch Giang's Build Coach files** (`BuildCoachView`, `InstallView`, `SummaryView`, `app/api/track*`, `app/api/build-plan`, `app/actions/install.ts`, installer core, `toolkit/hooks`). Ours: `lib/data.ts`, `lib/ai/toolkitUse.ts`, `lib/helpers.ts`, `lib/firebase/companyData.ts`, `lib/firebase/schema.ts`, `lib/store.tsx`, `components/artifact/ArtifactModal.tsx`, `components/views/EnvironmentView.tsx`, `app/globals.css`.
- **`LogStep`** = `{ t?: string; mono?: boolean; ck?: string }` (in `lib/helpers.ts`).
- **Worktree gotcha:** whole-repo `eslint .` HANGS here (eslint follows the symlinked `node_modules`). Use **scoped** `npx eslint <changed files>`. Also run `npm run format:check` before the final commit (CI's `verify` job runs it).

---

## File Structure

**Create:**
- `lib/ai/toolkitUse.ts` — pure core: `toolkitUsedFor`, `appendTaskUse`, `usageReceipt`, `runLogWithToolkit`.
- `lib/ai/toolkitUse.test.ts` — unit tests for all four.

**Modify:**
- `lib/data.ts` — `EnvItem` gains `fits?`/`tasks?`; seed `fits` on the catalog items.
- `lib/firebase/schema.ts` — `EnvUsage` type + `envUsage?` on the company doc.
- `lib/firebase/companyData.ts` — `envUsageFromCatalog`, `applyEnvUsage`, `persistEnvUsage`; apply on load.
- `lib/store.tsx` — `creditToolkitUse(taskTitle, type)` action + call it at the inline run produce; expose it in the API.
- `components/artifact/ArtifactModal.tsx` — compose the run log with toolkit steps; credit after produce.
- `components/views/EnvironmentView.tsx` — render the receipt on the recommended cards + browse rows.
- `app/globals.css` — receipt line styles.

---

### Task 1: Data model — `fits` / `tasks` on `EnvItem` + seed the catalog

**Files:**
- Modify: `lib/data.ts` (`EnvItem` interface ~line 69; the `ENV` catalog ~lines 78–140)

**Interfaces:**
- Produces: `EnvItem` gains `fits?: string[]` (deliverable types the item applies to) and `tasks?: string[]` (distinct task titles it's been used on). The catalog items are seeded with `fits`.

- [ ] **Step 1: Extend `EnvItem`**

In `lib/data.ts`, change the `EnvItem` interface to add the two optional fields:

```ts
export interface EnvItem {
  n: string;
  ab: string;
  d: string;
  s: number;
  rec?: number;
  why?: string;
  /** Deliverable types this item plausibly applies to — used to credit it when byte
   * runs a fitting task (see lib/ai/toolkitUse). */
  fits?: string[];
  /** Distinct task titles this item has been used on (append-on-use, deduped). Drives
   * the "Used in N tasks · last: …" receipt. Hydrated from the persisted envUsage. */
  tasks?: string[];
}
```

- [ ] **Step 2: Seed `fits` on the catalog items**

In the `ENV` catalog, add a `fits` array to each item. Use these exact values (deliverable types come from `artType`: `doc`, `prep`, `build`, `post`, `email`, `legal`, `screens`, `sheet`, `site`, `dms`, `calendar`, `checklist`, `plan`):

```ts
// skills
{ n: 'Web research', ab: 'Wr', d: 'byte searches the web and cites sources in its drafts.', s: 0, fits: ['post', 'doc', 'plan', 'sheet', 'email'] },
{ n: 'PRD writer', ab: 'Pr', d: 'Turn a rough idea into a structured product spec.', s: 1, rec: 1, why: 'Turn each beta feature into a clear spec before byte builds it.', fits: ['plan', 'doc', 'prep', 'build'] },
{ n: 'Code review', ab: 'Cr', d: 'Reviews diffs for bugs before anything ships.', s: 0, rec: 1, why: 'Catch bugs before they reach your beta testers.', fits: ['build'] },
{ n: 'Changelog', ab: 'Ch', d: 'Auto-drafts release notes from your commits.', s: 0, fits: ['post', 'doc'] },
// connectors
{ n: 'GitHub', ab: 'Gh', d: 'Read repos, open PRs, track issues.', s: 1, rec: 1, why: 'byte reads your repo and opens PRs as it ships beta work.', fits: ['build', 'site'] },
{ n: 'Notion', ab: 'No', d: 'Sync briefs, roadmaps, and docs.', s: 0, rec: 1, why: 'You collect beta feedback in Notion — connect it so byte can write there.', fits: ['doc', 'plan', 'prep', 'post', 'dms', 'checklist', 'calendar'] },
{ n: 'Figma', ab: 'Fi', d: 'Pull designs and components into context.', s: 0, fits: ['screens', 'site'] },
{ n: 'Slack', ab: 'Sl', d: 'Post updates and gather feedback.', s: 0, fits: ['dms', 'post', 'calendar'] },
{ n: 'Linear', ab: 'Li', d: 'Create and update issues from your tasks.', s: 0, fits: ['checklist', 'plan', 'build'] },
// agents
{ n: 'Code Reviewer', ab: 'Cr', d: 'A subagent that audits changes for correctness.', s: 0, fits: ['build'] },
{ n: 'Explorer', ab: 'Ex', d: 'Searches the codebase to answer questions fast.', s: 1, fits: ['build', 'doc'] },
{ n: 'Test Writer', ab: 'Tw', d: 'Generates tests for new code.', s: 0, rec: 1, why: 'Writes tests as byte ships each new beta feature.', fits: ['build'] },
{ n: 'Migrator', ab: 'Mg', d: 'Runs large, repetitive refactors safely.', s: 0, fits: ['build'] },
```

_(Keep the object formatting the file already uses — the point is each item now carries `fits`.)_

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: only the 2 pre-existing `firestore.rules.test.ts` errors (missing `@firebase/rules-unit-testing`) — baseline; no new errors.

- [ ] **Step 4: Commit**

```bash
git add lib/data.ts
git commit -m "feat(env): fits/tasks on EnvItem + seed fit tags on the toolkit catalog"
```

---

### Task 2: Pure core — `lib/ai/toolkitUse.ts`

**Files:**
- Create: `lib/ai/toolkitUse.ts`
- Test: `lib/ai/toolkitUse.test.ts`

**Interfaces:**
- Consumes: `LogStep` from `../helpers`; the catalog shape from Task 1 (`{ n, s, fits?, tasks? }`).
- Produces:
  - `type UsedItem = { name: string; category: string }`
  - `toolkitUsedFor(env: Record<string, { n: string; s: number; fits?: string[] }[]>, type: string): UsedItem[]` — on-items whose `fits` includes `type`.
  - `appendTaskUse(tasks: string[] | undefined, title: string): string[]` — deduped, capped at 20 most-recent.
  - `usageReceipt(tasks: string[] | undefined): string | null` — `"Used in N tasks · last: '…'"` or null.
  - `runLogWithToolkit(base: LogStep[], used: UsedItem[]): LogStep[]` — inserts one "used X" step per item before the base's last step.

- [ ] **Step 1: Write the failing test**

Create `lib/ai/toolkitUse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  toolkitUsedFor,
  appendTaskUse,
  usageReceipt,
  runLogWithToolkit,
} from './toolkitUse';
import type { LogStep } from '../helpers';

const env = {
  skills: [
    { n: 'Code review', s: 1, fits: ['build'] },
    { n: 'Changelog', s: 0, fits: ['build'] }, // off — excluded
    { n: 'Web research', s: 1, fits: ['post'] }, // wrong type — excluded
  ],
  connectors: [{ n: 'GitHub', s: 1, fits: ['build', 'site'] }],
};

describe('toolkitUsedFor', () => {
  it('returns on-items whose fits includes the type', () => {
    expect(toolkitUsedFor(env, 'build')).toEqual([
      { name: 'Code review', category: 'skills' },
      { name: 'GitHub', category: 'connectors' },
    ]);
  });
  it('excludes off items and non-fitting types', () => {
    expect(toolkitUsedFor(env, 'post')).toEqual([{ name: 'Web research', category: 'skills' }]);
    expect(toolkitUsedFor(env, 'sheet')).toEqual([]);
  });
});

describe('appendTaskUse', () => {
  it('appends, dedupes, and caps at 20', () => {
    expect(appendTaskUse(undefined, 'A')).toEqual(['A']);
    expect(appendTaskUse(['A'], 'A')).toEqual(['A']); // dedupe
    expect(appendTaskUse(['A'], 'B')).toEqual(['A', 'B']);
    const twenty = Array.from({ length: 20 }, (_, i) => `T${i}`);
    expect(appendTaskUse(twenty, 'NEW')).toHaveLength(20);
    expect(appendTaskUse(twenty, 'NEW').at(-1)).toBe('NEW');
    expect(appendTaskUse(twenty, 'NEW')[0]).toBe('T1'); // oldest dropped
  });
});

describe('usageReceipt', () => {
  it('formats count + last, singular/plural, null when empty', () => {
    expect(usageReceipt(undefined)).toBeNull();
    expect(usageReceipt([])).toBeNull();
    expect(usageReceipt(['Draft copy'])).toBe("Used in 1 task · last: 'Draft copy'");
    expect(usageReceipt(['A', 'Launch narrative'])).toBe("Used in 2 tasks · last: 'Launch narrative'");
  });
});

describe('runLogWithToolkit', () => {
  const base: LogStep[] = [{ t: 'Reading brief' }, { t: 'Writing the deliverable ↓' }];
  it('inserts a used-step per item before the last base step', () => {
    const out = runLogWithToolkit(base, [
      { name: 'Code review', category: 'skills' },
      { name: 'GitHub', category: 'connectors' },
    ]);
    expect(out.map((s) => s.t)).toEqual([
      'Reading brief',
      'Reviewed the work with the Code review skill',
      'Worked through your GitHub connection',
      'Writing the deliverable ↓',
    ]);
    out.slice(1, 3).forEach((s) => expect(s.ck).toBeUndefined());
  });
  it('returns base unchanged when nothing used', () => {
    expect(runLogWithToolkit(base, [])).toEqual(base);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ai/toolkitUse.test.ts`
Expected: FAIL — cannot resolve `./toolkitUse`.

- [ ] **Step 3: Write the implementation**

Create `lib/ai/toolkitUse.ts`:

```ts
import type { LogStep } from '../helpers';

export type UsedItem = { name: string; category: string };

type EnvLike = Record<string, { n: string; s: number; fits?: string[] }[]>;

// The on-items (s === 1) whose fit list includes this deliverable type. Single source of
// truth for both the execute-log mention and the receipt, so they never disagree.
export function toolkitUsedFor(env: EnvLike, type: string): UsedItem[] {
  const out: UsedItem[] = [];
  for (const [category, items] of Object.entries(env)) {
    for (const item of items) {
      if (item.s === 1 && item.fits?.includes(type)) out.push({ name: item.n, category });
    }
  }
  return out;
}

// Append a task title to an item's usage list — deduped (a re-run/revise of the same task
// never inflates the count) and capped at the 20 most recent.
export function appendTaskUse(tasks: string[] | undefined, title: string): string[] {
  const list = tasks ?? [];
  if (list.includes(title)) return list;
  return [...list, title].slice(-20);
}

// "Used in N tasks · last: '…'" — or null when the item has no usage yet.
export function usageReceipt(tasks: string[] | undefined): string | null {
  if (!tasks || tasks.length === 0) return null;
  const n = tasks.length;
  return `Used in ${n} task${n === 1 ? '' : 's'} · last: '${tasks[tasks.length - 1]}'`;
}

// One believable "byte used X" line per item, inserted before the base log's final step.
export function runLogWithToolkit(base: LogStep[], used: UsedItem[]): LogStep[] {
  if (!used.length || !base.length) return base;
  const verb = (u: UsedItem): string =>
    u.category === 'connectors'
      ? `Worked through your ${u.name} connection`
      : u.category === 'agents'
        ? `Ran the ${u.name} agent`
        : `Reviewed the work with the ${u.name} skill`;
  const steps: LogStep[] = used.map((u) => ({ t: verb(u) }));
  return [...base.slice(0, -1), ...steps, base[base.length - 1]];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ai/toolkitUse.test.ts`
Expected: PASS — 4 describes, all green.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/toolkitUse.ts lib/ai/toolkitUse.test.ts
git commit -m "feat(toolkit): pure core — who's credited, the receipt, and the run-log mention"
```

---

### Task 3: Persist usage additively (`envUsage`)

**Files:**
- Modify: `lib/firebase/schema.ts` (`EnvUsage` type + company doc field)
- Modify: `lib/firebase/companyData.ts` (`envUsageFromCatalog`, `applyEnvUsage`, `persistEnvUsage`; apply on load ~line 167)

**Interfaces:**
- Consumes: the `ENV` catalog (`tasks` from Task 1).
- Produces:
  - `type EnvUsage = Record<string, Record<string, string[]>>` (category → itemName → task titles).
  - `envUsageFromCatalog(): EnvUsage`
  - `applyEnvUsage(usage: EnvUsage): void`
  - `persistEnvUsage(companyId: string, usage: EnvUsage): Promise<void>`

- [ ] **Step 1: Add the `EnvUsage` type + doc field**

In `lib/firebase/schema.ts`, after the `EnvState` type (line 62), add:

```ts
/** Per-item usage: category → item name → the distinct task titles it's been used on. */
export type EnvUsage = Record<string, Record<string, string[]>>;
```

Then on the company-doc interface, next to `env: EnvState;` (line ~79), add:

```ts
  envUsage?: EnvUsage;
```

- [ ] **Step 2: Add the catalog<->usage helpers**

In `lib/firebase/companyData.ts`, import `EnvUsage` alongside the existing `EnvState` import (line ~29), then add — right after `applyEnvState` (ends ~line 90):

```ts
// ---- env usage <-> ENV catalog (additive; independent of the on/off env map) ----
export function envUsageFromCatalog(): EnvUsage {
  const usage: EnvUsage = {};
  for (const [category, items] of Object.entries(ENV)) {
    usage[category] = {};
    for (const item of items) if (item.tasks?.length) usage[category][item.n] = item.tasks;
  }
  return usage;
}

/** Apply a persisted usage map back onto the ENV catalog singleton. Self-resetting: an
 * item not present in `usage` is cleared, so a previously signed-in account's usage can
 * never leak into a freshly loaded one (an empty map clears everything). */
export function applyEnvUsage(usage: EnvUsage): void {
  for (const [category, items] of Object.entries(ENV)) {
    const saved = usage[category] ?? {};
    for (const item of items) item.tasks = Array.isArray(saved[item.n]) ? saved[item.n] : undefined;
  }
}

export async function persistEnvUsage(companyId: string, usage: EnvUsage): Promise<void> {
  const db = getDb();
  await updateDoc(doc(db, paths.company(companyId)), { envUsage: usage, updatedAt: Date.now() });
}
```

- [ ] **Step 3: Apply usage on load**

In `loadCompanyData` (the hydration, right after `applyEnvState((company?.env ?? {}) as EnvState);` at line ~167), add:

```ts
  applyEnvUsage((company?.envUsage ?? {}) as EnvUsage);
```

_(No separate reset step is needed: `applyEnvUsage` is self-resetting, and it runs on every hydration — a new account with no `envUsage` loads an empty map, which clears every item's `tasks`.)_

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: only the 2 baseline `firestore.rules.test.ts` errors; no new.

- [ ] **Step 5: Commit**

```bash
git add lib/firebase/schema.ts lib/firebase/companyData.ts
git commit -m "feat(env): persist toolkit usage additively as envUsage (no env migration)"
```

---

### Task 4: Credit on run + name items in the execute log

**Files:**
- Modify: `lib/store.tsx` (`AppState` API ~line 165; new `creditToolkitUse` ~near `toggleEnv`; call it in `runTaskInChat` after `applyResult` line ~989; expose in the context value)
- Modify: `components/artifact/ArtifactModal.tsx` (buildLog call ~line 464; credit after `applyResult` line ~254)

**Interfaces:**
- Consumes: `toolkitUsedFor`, `runLogWithToolkit`, `appendTaskUse` (Task 2); `envUsageFromCatalog`, `persistEnvUsage` (Task 3); `buildLog` (`lib/helpers`).
- Produces: `creditToolkitUse(taskTitle: string, type: string): void` on the app store.

- [ ] **Step 1: Add the store action + expose it**

In `lib/store.tsx`:

1. Add imports (with the existing `./helpers` / `./ai/...` imports):

```tsx
import { toolkitUsedFor, appendTaskUse } from './ai/toolkitUse';
import { envUsageFromCatalog, persistEnvUsage } from './firebase/companyData';
```

2. In the `AppState` interface, next to `toggleEnv` (line ~165), add:

```tsx
  /** Credit the on-items that fit a produced task's type (deduped) + persist. */
  creditToolkitUse: (taskTitle: string, type: string) => void;
```

3. Define the action near `toggleEnv` (which is ~line 869 and shows the `companyId`/`persistEnv` pattern — mirror it):

```tsx
  const creditToolkitUse = useCallback(
    (taskTitle: string, type: string) => {
      const used = toolkitUsedFor(ENV, type);
      if (!used.length) return;
      for (const u of used) {
        const item = ENV[u.category]?.find((x) => x.n === u.name);
        if (item) item.tasks = appendTaskUse(item.tasks, taskTitle);
      }
      bump();
      const cid = companyId.current;
      if (cid) {
        persistEnvUsage(cid, envUsageFromCatalog()).catch((err) => {
          console.error('[store] persistEnvUsage failed', err);
        });
      }
    },
    [bump],
  );
```

_(Match the exact `companyId` accessor `toggleEnv` uses — copy its shape; `toggleEnv` at line ~869 shows whether it's `companyId.current`, a ref, or a variable.)_

4. Add `creditToolkitUse` to the context value object (both places the provider spreads the actions — mirror where `toggleEnv` appears in the value).

- [ ] **Step 2: Credit on the inline run**

In `runTaskInChat`, right after `applyResult(t, type, res);` (line ~989), add:

```tsx
        creditToolkitUse(t.t, type);
```

(Add `creditToolkitUse` to that `useCallback`'s dependency array.)

- [ ] **Step 3: Name items in the modal's execute log + credit there**

In `components/artifact/ArtifactModal.tsx`:

1. Add imports:

```tsx
import { toolkitUsedFor, runLogWithToolkit } from '@/lib/ai/toolkitUse';
import { ENV } from '@/lib/data';
```

2. Pull `creditToolkitUse` from `useApp()` (add it to the destructured actions).

3. At the buildLog call (line ~464), wrap the non-revise branch so the log names the fitting on-items:

```tsx
    const steps =
      execKind === 'revise'
        ? reviseSteps(rev || '')
        : runLogWithToolkit(buildLog(t, logType, d), toolkitUsedFor(ENV, logType));
```

4. After `applyResult(t, type, res);` at line ~254 (the run/produce path), add:

```tsx
          creditToolkitUse(t.t, type);
```

- [ ] **Step 4: Typecheck + scoped lint**

Run: `npm run typecheck && npx eslint lib/store.tsx components/artifact/ArtifactModal.tsx`
Expected: typecheck shows only the 2 baseline errors; scoped eslint 0 errors. (Do NOT run `npm run lint` / `eslint .` — it hangs here.)

- [ ] **Step 5: Commit**

```bash
git add lib/store.tsx components/artifact/ArtifactModal.tsx
git commit -m "feat(toolkit): credit fitting on-items on run + name them in the execute log"
```

---

### Task 5: Show the receipt in the Environment view

**Files:**
- Modify: `components/views/EnvironmentView.tsx` (recommended cards ~line 58; browse rows ~line 96)
- Modify: `app/globals.css` (receipt styles, near the `.rcard`/`.erow` rules)

**Interfaces:**
- Consumes: `usageReceipt` (Task 2); `EnvItem.tasks` (Task 1).
- Produces: the `Used in N tasks · last: '…'` line on each used item.

- [ ] **Step 1: Import the helper**

In `components/views/EnvironmentView.tsx`, add:

```tsx
import { usageReceipt } from '@/lib/ai/toolkitUse';
```

- [ ] **Step 2: Receipt on the recommended cards**

After the `rc-why` div (line ~58), add:

```tsx
                {usageReceipt(x.tasks) && <div className="rc-used">{usageReceipt(x.tasks)}</div>}
```

- [ ] **Step 3: Receipt on the browse rows**

Replace the `en` name div (line ~98) so the name and receipt stack:

```tsx
                      <div className="en">
                        <span className="en-n">{x.n}</span>
                        {usageReceipt(x.tasks) && <span className="en-used">{usageReceipt(x.tasks)}</span>}
                      </div>
```

- [ ] **Step 4: Add the CSS**

In `app/globals.css`, near the `.rcard` / `.erow` rules (find with `grep -n "\.rc-why\|\.erow\|\.en\b" app/globals.css`), add:

```css
/* toolkit usage receipt — "Used in N tasks · last: …" */
.rc-used {
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--t-3);
}
.env-card .en {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.env-card .en-used {
  font-size: 11px;
  color: var(--t-4);
}
```

- [ ] **Step 5: Typecheck + scoped lint**

Run: `npm run typecheck && npx eslint components/views/EnvironmentView.tsx`
Expected: typecheck only the 2 baseline errors; scoped eslint 0 errors.

- [ ] **Step 6: Full gate**

Run: `npm run typecheck && npm run test && npm run format:check`
Expected: typecheck baseline unchanged; Vitest green (includes `lib/ai/toolkitUse.test.ts`); format clean. If `format:check` flags a touched file, run `npm run format` and re-commit (CI's `verify` job runs `format:check`).

- [ ] **Step 7: Manual verification (deferred to the Vercel PR preview)**

_Not runnable here (`next build`/`next dev` unreliable). Checklist:_ turn on **Code review** + **GitHub** → run a **build**-type task from a department (the modal) → the execute log names both ("Reviewed the work with the Code review skill", "Worked through your GitHub connection") → the Environment card shows *"Used in 1 task · last: '<title>'"* → run a second build task → count → 2, last updates → re-run the same task → count unchanged → run a **marketing post** → GitHub is NOT credited/named → reload → the receipts persist.

- [ ] **Step 8: Commit**

```bash
git add components/views/EnvironmentView.tsx app/globals.css
git commit -m "feat(env): show the 'Used in N tasks · last: …' receipt on toolkit items"
```

---

## Notes for the executor

- **Worktree limits:** `next build`/`next dev` are unreliable (symlinked `node_modules`); whole-repo `eslint .` hangs. Gate on typecheck + scoped lint + `npm run test` + `format:check`; visual behavior verifies on the Vercel PR preview.
- **`buildLog` mention appears in the modal today**; the inline chat run adopts it once PR #71 (inline `ExecLog`) merges — not a dependency of this feature. The **credit** hooks both paths, so usage accrues regardless.
- **Baseline:** `npm run typecheck` shows exactly 2 pre-existing `firestore.rules.test.ts` errors — environmental, unrelated; confirm the count is unchanged.
