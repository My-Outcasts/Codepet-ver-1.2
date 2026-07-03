# Honest Task States (Awaiting Approval) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give tasks a real, persisted "Awaiting your approval" state so a task byte hasn't drafted reads as "Up next" (not "Needs approval"), a produced draft survives reload as "review this," and approval moves it to Done — ending the "Have byte draft it" + "Needs approval" contradiction everywhere.

**Architecture:** One optional persisted marker `Task.drafted`, set the moment byte produces a reviewable draft (at the single `applyResult` produce point) and persisted inline in the department doc (which already rehydrates on load, and is already member-writable — no rules change). The shared `taskState()` helper gains an `awaiting` branch and honest labels; the Tasks board and department detail derive everything from it.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Firebase Firestore, Vitest.

## Global Constraints

- Work only in the worktree `/private/tmp/claude-501/-Users-monatruong/d31cb161-d475-4451-86b0-aea1ff23a43b/scratchpad/wt-states` on branch `feat/awaiting-approval-state`. Never touch the main checkout.
- **Do not modify Giang's Build Coach files** (BuildCoachView / InstallView / SummaryView, tracking, toolkit/hooks, `/api/track*`, `/api/build-plan`) or any file outside those named in tasks below.
- No Firestore **rules** change — tasks persist inline in the already-member-writable department doc.
- Reuse existing `st-*` cls names and `STATE_HEX` colors — do **not** add new cls or CSS: "Awaiting your approval" → `st-draft` (gold), "Up next" → `st-does` (purple), "Your move" → `st-you`, "Done" → `st-done`.
- No decorative icons/emojis/arrows in new copy; plain minimalist labels.
- Run tools via local binaries: `./node_modules/.bin/{tsc,eslint,prettier,vitest}`.
- Gate green before each commit: `tsc --noEmit` (ignore pre-existing firestore.rules.test.ts errors), `eslint <changed files>` (exit 0), `prettier --check`, `vitest run`.
- Commit after each task. Do not push or open a PR until the user asks.

---

### Task 1: `drafted` field + honest `taskState` (+ tests)

**Files:**
- Modify: `lib/data.ts` (Task interface)
- Modify: `lib/helpers.ts` (`taskState`)
- Modify: `lib/helpers.test.ts` (taskState tests)

**Interfaces:**
- Produces: `Task.drafted?: boolean`; `taskState(t, available?)` now returns `{label, cls}` with an `awaiting` branch. Labels: Done / Locked / **Awaiting your approval** (`st-draft`) / **Your move** (`st-you`) / **Up next** (`st-does`).

- [ ] **Step 1: Update the failing tests first**

In `lib/helpers.test.ts`, find the `describe('taskState', …)` block and replace its cases with these (the labels changed, and two new cases assert the awaiting state + done-precedence):

```ts
describe('taskState', () => {
  it('done wins over everything, including a lingering drafted flag', () => {
    expect(taskState(task({ done: true, drafted: true }), false).label).toBe('Done');
  });
  it('available === false is Locked', () => {
    expect(taskState(task(), false).cls).toBe('st-locked');
  });
  it('a produced draft is Awaiting your approval (gold)', () => {
    const s = taskState(task({ who: 'draft', drafted: true }), true);
    expect(s.label).toBe('Awaiting your approval');
    expect(s.cls).toBe('st-draft');
  });
  it('a draft byte has not produced yet is Up next, not awaiting', () => {
    const s = taskState(task({ who: 'draft' }), true);
    expect(s.label).toBe('Up next');
    expect(s.cls).toBe('st-does');
  });
  it('a you-task is Your move', () => {
    const s = taskState(task({ who: 'you' }), true);
    expect(s.label).toBe('Your move');
    expect(s.cls).toBe('st-you');
  });
  it('a does-task is Up next (byte queue)', () => {
    expect(taskState(task({ who: 'does' }), true).label).toBe('Up next');
  });
});
```

Confirm the `task()` helper at the top of `helpers.test.ts` spreads overrides onto a base `Task` (it does — it is used with `{done:true}` etc. already). If it doesn't accept `drafted`/`who` overrides, widen it minimally.

- [ ] **Step 2: Run the tests — verify they fail**

Run: `./node_modules/.bin/vitest run lib/helpers.test.ts`
Expected: FAIL (labels differ / `drafted` unknown on Task).

- [ ] **Step 3: Add `drafted` to the Task interface**

In `lib/data.ts`, inside `export interface Task {`, add after the `done?: boolean;` line:

```ts
  // Set true once byte has produced a reviewable draft the founder hasn't approved
  // yet — persisted on the task so the "awaiting approval" state survives reload.
  // Moot once `done`. Never meaningfully set for ship (route) tasks — they go to Done.
  drafted?: boolean;
```

- [ ] **Step 4: Rewrite `taskState` in `lib/helpers.ts`**

Replace the existing `taskState` body (currently branches on `who` with labels "Needs your approval" / "Needs your input" / "byte does this") with:

```ts
// shared task-state vocabulary — the honest state a task is actually in.
// Order matters: done and locked first, then a produced-but-unapproved draft
// (Awaiting), then the founder's own tasks, then byte's queue (draft-not-yet + does).
export function taskState(t: Task, available?: boolean): TaskStateInfo {
  if (t.done) return { label: 'Done', cls: 'st-done' };
  if (available === false) return { label: 'Locked', cls: 'st-locked' };
  if (t.drafted) return { label: 'Awaiting your approval', cls: 'st-draft' };
  if (t.who === 'you') return { label: 'Your move', cls: 'st-you' };
  return { label: 'Up next', cls: 'st-does' };
}
```

- [ ] **Step 5: Run tests — verify pass + full suite green**

Run: `./node_modules/.bin/vitest run lib/helpers.test.ts` → PASS.
Then `./node_modules/.bin/tsc --noEmit` (ignore firestore.rules.test.ts) and `./node_modules/.bin/eslint lib/data.ts lib/helpers.ts lib/helpers.test.ts` → clean, and `./node_modules/.bin/prettier --write lib/data.ts lib/helpers.ts lib/helpers.test.ts && ./node_modules/.bin/prettier --check` those files.

- [ ] **Step 6: Commit**

```bash
git add lib/data.ts lib/helpers.ts lib/helpers.test.ts
git commit -m "feat(states): drafted flag + honest taskState (Awaiting/Up next/Your move)"
```

---

### Task 2: Persist the draft state (`drafted` on produce → Firestore)

Make the awaiting state real: when byte produces a draft, set `drafted` and persist the department's tasks so it survives reload.

**Files:**
- Modify: `lib/firebase/companyData.ts` (add `persistDepartmentTasks`)
- Modify: `lib/store.tsx` (set `drafted` + persist after each `applyResult`; expose `persistTaskDraft` for the modal)
- Modify: `components/artifact/ArtifactModal.tsx` (call `persistTaskDraft` after its produce/revise `applyResult`)

**Interfaces:**
- Consumes: `applyResult` (existing), `taskState` (Task 1), the `DepartmentDoc`/department write paths in `companyData`.
- Produces: `persistDepartmentTasks(companyId: string, dept: Dept): Promise<void>`; a store context method `persistTaskDraft(deptK: string, taskTitle: string): void` that sets `t.drafted = true`, bumps, and persists the department.

- [ ] **Step 1: Add `persistDepartmentTasks` to `lib/firebase/companyData.ts`**

Find how a department doc is written today (look for `paths.departments`, `setDoc`/`updateDoc` on a department, and the `DepartmentDoc` shape — tasks are inline). Add, mirroring the existing department write:

```ts
/** Persist a single department's current tasks (e.g. after byte produces a draft,
 * so the task's `drafted` flag + draft payload survive reload). Members may write
 * department docs, so no rules change is needed. Optimistic: the in-memory task
 * already updated; this write-through can fail without breaking the session. */
export async function persistDepartmentTasks(companyId: string, dept: Dept): Promise<void> {
  await setDoc(
    doc(getDb(), paths.department(companyId, dept.k)),
    { k: dept.k, name: dept.name, ab: dept.ab, status: dept.status, need: dept.need, byte: dept.byte, later: dept.later ?? false, tasks: dept.tasks },
    { merge: true },
  );
}
```

Verify the exact `paths.department(...)` helper name and the `DepartmentDoc` field list against the file; match them exactly (use the same field set `applyScaffold`/`persistScaffold` writes). If a suitable single-department writer already exists, wrap it instead of duplicating.

- [ ] **Step 2: Add `persistTaskDraft` in `lib/store.tsx` and wire the produce sites**

Import `persistDepartmentTasks`. Add a `useCallback` near the other chat/task actions:

```ts
  // byte produced a reviewable draft for this task — mark it awaiting the founder's
  // approval and persist so the state survives reload. `done` (on approve) supersedes.
  const persistTaskDraft = useCallback(
    (deptK: string, taskTitle: string) => {
      const d = DEPTS.find((x) => x.k === deptK);
      const t = d?.tasks.find((x) => x.t === taskTitle);
      if (!d || !t || t.done || t.run === 'route') return; // ship-type never "awaits"
      t.drafted = true;
      bump();
      if (companyId) persistDepartmentTasks(companyId, d).catch((err) => console.error('[store] persistTaskDraft failed', err));
    },
    [companyId, bump],
  );
```

In `runTaskInChat`, after the successful `applyResult(t, type, res)` + `bump()`, add:

```ts
        persistTaskDraft(d.k, t.t);
```

Do the same in `reviseTaskInChat` after its `applyResult`. Add `persistTaskDraft` to the `AppState` interface and to BOTH context-value objects.

- [ ] **Step 3: Mark drafted from the run modal**

In `components/artifact/ArtifactModal.tsx`, pull `persistTaskDraft` from `useApp()` (it already destructures store actions). After the modal's produce `applyResult(t, type, res)` (the initial generation) and after the revise `applyResult`, call `persistTaskDraft(t's deptK, t.t)` (the modal has the task `t` and its dept `dept`/`d` in scope — use its key). Do not change the approve path (`approveTask` already sets `done`, which supersedes `drafted`).

- [ ] **Step 4: Gate**

```bash
./node_modules/.bin/tsc --noEmit    # ignore firestore.rules.test.ts
./node_modules/.bin/eslint lib/firebase/companyData.ts lib/store.tsx components/artifact/ArtifactModal.tsx
./node_modules/.bin/prettier --write lib/firebase/companyData.ts lib/store.tsx components/artifact/ArtifactModal.tsx && ./node_modules/.bin/prettier --check lib/firebase/companyData.ts lib/store.tsx components/artifact/ArtifactModal.tsx
./node_modules/.bin/vitest run
```
Expected: all clean/pass. No React unit test is expected for store/modal wiring (no harness); correctness rests on the gate + Task 5 manual proof.

- [ ] **Step 5: Commit**

```bash
git add lib/firebase/companyData.ts lib/store.tsx components/artifact/ArtifactModal.tsx
git commit -m "feat(states): persist drafted so Awaiting-approval survives reload"
```

---

### Task 3: Tasks board — 4 state-derived lanes

Replace the `who`-keyed columns (whose "Needs approval" lane is the bug) with lanes derived from `taskState`.

**Files:**
- Modify: `components/views/TasksView.tsx`

**Interfaces:**
- Consumes: `taskState` (Task 1). Buckets by `taskState(t, true).cls`.

- [ ] **Step 1: Replace the `COLS` definition**

Find the `COLS` array (four entries keyed on `who`/`done` with labels 'Needs approval' / 'Needs input' / 'byte is doing' / 'Done'). Replace with lanes keyed on the derived state's `cls`:

```ts
import { artType, artMeta, taskState } from '@/lib/helpers'; // ensure taskState is imported

// Kanban columns by the task's real state (via taskState). "byte's queue"
// (draft-not-yet + does) folds into Up next; a produced draft sits in Awaiting.
const COLS: Array<{ key: string; label: string; dot: string; test: (x: Row) => boolean }> = [
  { key: 'upnext',   label: 'Up next',                dot: 'var(--accent)', test: (x) => taskState(x.t, true).cls === 'st-does' },
  { key: 'awaiting', label: 'Awaiting your approval', dot: 'var(--gold)',   test: (x) => taskState(x.t, true).cls === 'st-draft' },
  { key: 'you',      label: 'Your move',              dot: 'var(--blue)',   test: (x) => taskState(x.t, true).cls === 'st-you' },
  { key: 'done',     label: 'Done',                   dot: '#10B981',        test: (x) => !!x.t.done },
];
```

Keep the rest of the render (the `COLS.map(... ALL.filter(c.test) ...)` loop) unchanged — it already renders one lane per `COLS` entry. Verify `Row` still exposes `x.t` (the task); if the filter used `x.t.who`/`x.t.done` before, `taskState(x.t, true)` is the drop-in.

- [ ] **Step 2: Gate**

```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint components/views/TasksView.tsx
./node_modules/.bin/prettier --write components/views/TasksView.tsx && ./node_modules/.bin/prettier --check components/views/TasksView.tsx
./node_modules/.bin/vitest run
```

- [ ] **Step 3: Commit**

```bash
git add components/views/TasksView.tsx
git commit -m "feat(states): tasks board lanes derive from real state (no more Needs-approval on undrafted)"
```

---

### Task 4: Department detail — action derives from state

The status tag already comes from `taskState` (fixed in Task 1). Fix the **action button** so a drafted task offers Review/Approve, not "Have byte draft it".

**Files:**
- Modify: `components/views/DepartmentDetail.tsx`

**Interfaces:**
- Consumes: `taskState` (already imported), `runTask` (opens the modal, which shows an existing draft for review/approve).

- [ ] **Step 1: Branch the action block on the drafted state**

Find the task card's `<div className="tk-act">` block (currently: `t.who === 'you'` → "Walk me through it", else a button labeled `t.who === 'draft' ? 'Have byte draft it' : 'Have byte do it'`). Replace with a three-way branch that puts a produced draft into review:

```tsx
      <div className="tk-act">
        {t.drafted ? (
          <button className="btn" onClick={() => runTask(t, dept)}>
            Review &amp; approve
          </button>
        ) : t.who === 'you' ? (
          <button className="btn ghost" onClick={() => runTask(t, dept, true)}>
            Walk me through it
          </button>
        ) : (
          <button className="btn" onClick={() => runTask(t, dept)}>
            {t.who === 'draft' ? 'Have byte draft it' : 'Have byte do it'}
          </button>
        )}
      </div>
```

(`runTask(t, dept)` opens the run modal; when a draft already exists on the task, the modal shows it for review/approve — confirm this in the modal during Task 5's manual pass. If the modal instead re-generates, note it in the report; a follow-up would route drafted tasks to the viewer, but do NOT expand scope here.)

- [ ] **Step 2: Gate**

```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint components/views/DepartmentDetail.tsx
./node_modules/.bin/prettier --write components/views/DepartmentDetail.tsx && ./node_modules/.bin/prettier --check components/views/DepartmentDetail.tsx
./node_modules/.bin/vitest run
```

- [ ] **Step 3: Commit**

```bash
git add components/views/DepartmentDetail.tsx
git commit -m "feat(states): department detail offers Review & approve on drafted tasks"
```

---

### Task 5: Full-gate + manual verification

No new code — prove the state loop end-to-end and that the whole suite is green.

**Files:** none.

- [ ] **Step 1: Full gate from the worktree**

```bash
cd <worktree>
./node_modules/.bin/prettier --check .
./node_modules/.bin/tsc --noEmit          # ignore ONLY pre-existing firestore.rules.test.ts errors
./node_modules/.bin/eslint .              # exit 0
./node_modules/.bin/vitest run            # all pass
```

- [ ] **Step 2: Manual proof (localhost, signed in)**

Copy `.env.local` from the main checkout into the worktree, start the webpack dev server (`PORT=3011 ./node_modules/.bin/next dev --webpack`), hand the URL to the user to sign in (localhost is Firebase-authorized). Then verify:
1. A `draft`-type task that byte hasn't produced shows **"Up next"** on the board and **"Have byte draft it"** on its department card — never "Needs/Awaiting approval".
2. Click "Have byte draft it" → byte produces a draft → the task moves to **"Awaiting your approval"** (gold) on the board and its card shows **"Review & approve"**.
3. **Reload the page** → the task is *still* "Awaiting your approval" (the B2 proof — draft persisted).
4. Approve it → **Done**. Confirm no card anywhere shows an "approval" tag next to a "Have byte draft it" button.

- [ ] **Step 3: Stop the dev server**

```bash
lsof -ti:3011 | xargs kill -9 2>/dev/null || true
```

- [ ] **Step 4: Report** the verified loop + gate result. Do not push or open a PR until the user asks.

---

## Self-Review

**Spec coverage:**
- `Task.drafted` persisted marker → Task 1 (field) + Task 2 (set + persist). ✓
- Honest `taskState` (Up next / Awaiting / Your move / Done) → Task 1. ✓
- Survives reload → Task 2 (persist inline in dept doc) + Task 5 step 3 proof. ✓
- 4-lane board, "byte handles" folded into Up next → Task 3. ✓
- Dept detail: no "Have byte draft it" under an approval tag → Task 4 (button) + Task 1 (tag). ✓
- No rules change; reuse existing cls/colors → Global Constraints + Task 1. ✓
- Ship/route tasks never "await" → Task 2 (`t.run === 'route'` guard) + Task 1 test (done precedence). ✓

**Placeholder scan:** No TBD/TODO; every code step carries real code. The two "verify the exact path/modal behavior" notes are directed verifications with a named fallback, not placeholders. ✓

**Type consistency:** `Task.drafted?: boolean`, `taskState(t, available?) → {label, cls}`, `persistDepartmentTasks(companyId, dept)`, `persistTaskDraft(deptK, taskTitle)` — names identical across tasks. `cls` values (`st-done`/`st-draft`/`st-you`/`st-does`/`st-locked`) match existing CSS + `STATE_HEX`. ✓
