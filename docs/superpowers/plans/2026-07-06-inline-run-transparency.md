# Inline Run Transparency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every inline chat run *show byte doing the work* — a live execute log while it runs, folded afterward into a re-openable "What byte did · N steps" record — while keeping the existing Approve / Read / Revise gate untouched.

**Architecture:** Reuse the deliverable modal's execution machinery in the chat card. Extract the modal's `ExecLog` into a shared component; generate a run's steps once with the existing pure `buildLog`; store them on the chat message; render the streaming log in `ResultCard` while the run is in flight (dual-gated on log-done AND produce-done), then a collapsed static record above the unchanged review row.

**Tech Stack:** Next.js 16 App Router, React, TypeScript, CSS (`app/globals.css`), Vitest (`*.test.ts`, node env).

## Global Constraints

_Every task's requirements implicitly include this section. Copy verbatim into each reviewer dispatch._

- **Reuse `buildLog`, don't reinvent.** `buildLog(t: Task, type: string, d: { k: string }): LogStep[]` already exists in `lib/helpers.ts` and is the single source of run steps — the inline log uses the same generator as the modal so they never diverge.
- **Keep the save/approve flow exactly as-is.** The existing **Approve / Read / Revise** gate on a produced inline result stays; nothing auto-approves or auto-saves. `approveChatResult` is untouched.
- **Motion-guarded.** The streaming log respects `prefers-reduced-motion` — under reduce, show the whole log immediately and fire `onDone`.
- **Honesty on failure.** A failed produce keeps the current error behavior; it must never show a success log or a saved/produced state.
- **Never crash on absent steps.** An older persisted message (or any run without `steps`) falls back to the current compact `"Producing…"` running state and no record toggle.
- **Do NOT touch Giang's Build Coach files** (`BuildCoachView`, `InstallView`, `SummaryView`, `app/api/track*`, `app/api/build-plan`, `app/actions/install.ts`, installer core, `toolkit/hooks`). Ours: `lib/helpers.ts`, `components/artifact/*`, `lib/store.tsx`, `components/Copilot.tsx`, `app/globals.css`.
- **`LogStep`** = `{ t?: string; mono?: boolean; ck?: string }` (defined in `lib/helpers.ts`).

---

## File Structure

**Create:**
- `components/artifact/ExecLog.tsx` — shared streaming `ExecLog` (moved from the modal) + a static `StaticLog` for the record.
- `lib/helpers.test.ts` — unit test for the new `stepCountLabel` helper.

**Modify:**
- `lib/helpers.ts` — add `stepCountLabel(steps): string`.
- `components/artifact/ArtifactModal.tsx` — delete the local `ExecLog`, import the shared one.
- `lib/store.tsx` — `ChatMessage.steps?: LogStep[]`; attach steps in `runTaskInChat` + `reviseTaskInChat`.
- `components/Copilot.tsx` — `ResultCard`: stream the log (dual-gated) + the "What byte did" record.
- `app/globals.css` — fit the exec log in the chat card + the record toggle styles.

---

### Task 1: `stepCountLabel` pure helper

**Files:**
- Modify: `lib/helpers.ts` (add after `buildLog`, which ends near line 300)
- Test: `lib/helpers.test.ts` (create)

**Interfaces:**
- Consumes: `LogStep` (already exported from `lib/helpers.ts`).
- Produces: `stepCountLabel(steps: LogStep[]): string` — `"0 steps"`, `"1 step"`, `"8 steps"`.

- [ ] **Step 1: Write the failing test**

Create `lib/helpers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { stepCountLabel, type LogStep } from './helpers';

describe('stepCountLabel', () => {
  it('pluralizes by count', () => {
    expect(stepCountLabel([])).toBe('0 steps');
    expect(stepCountLabel([{ t: 'a' }])).toBe('1 step');
    const three: LogStep[] = [{ t: 'a' }, { mono: true, t: 'b' }, { ck: 'c' }];
    expect(stepCountLabel(three)).toBe('3 steps');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/helpers.test.ts`
Expected: FAIL — `stepCountLabel` is not exported from `./helpers`.

- [ ] **Step 3: Write minimal implementation**

In `lib/helpers.ts`, add immediately after the `buildLog` function:

```ts
/** "8 steps" / "1 step" — the count label for the inline "What byte did" record. */
export function stepCountLabel(steps: LogStep[]): string {
  const n = steps.length;
  return `${n} step${n === 1 ? '' : 's'}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/helpers.test.ts`
Expected: PASS — 1 test, 3 assertions.

- [ ] **Step 5: Commit**

```bash
git add lib/helpers.ts lib/helpers.test.ts
git commit -m "feat(helpers): stepCountLabel for the inline run record"
```

---

### Task 2: Shared `ExecLog` + `StaticLog` (extract from the modal)

**Files:**
- Create: `components/artifact/ExecLog.tsx`
- Modify: `components/artifact/ArtifactModal.tsx` (delete local `ExecLog` at lines ~59–133; add an import)

**Interfaces:**
- Consumes: `LogStep` from `@/lib/helpers`.
- Produces:
  - `ExecLog({ steps, title, onDone }: { steps: LogStep[]; title: React.ReactNode; onDone: () => void })` — streaming log; reduced-motion-aware.
  - `StaticLog({ steps }: { steps: LogStep[] })` — the finished log, no animation, for the record.

This is a faithful move of the existing `ExecLog` (so the modal is unchanged) plus reduced-motion handling and a static twin. `Phx` (the Outline→Execute→Deliver stepper) stays in the modal — the inline card doesn't use it.

- [ ] **Step 1: Create the shared component**

Create `components/artifact/ExecLog.tsx`:

```tsx
'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LogStep } from '@/lib/helpers';

// Shared by the deliverable modal and the inline chat card. A run's steps stream in one
// by one with a "Ran N actions" counter; onDone fires once the log has played through.
// Under prefers-reduced-motion the whole log shows at once.
export function ExecLog({
  steps,
  title,
  onDone,
}: {
  steps: LogStep[];
  title: ReactNode;
  onDone: () => void;
}) {
  const [shown, setShown] = useState(0);
  const [complete, setComplete] = useState(false);
  const actions = useRef(0);
  const [actionCount, setActionCount] = useState(0);

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      const total = steps.reduce((a, s) => a + 3 + ((s.t || s.ck || '').length % 6), 0);
      setActionCount(total);
      setShown(steps.length);
      setComplete(true);
      const t = setTimeout(onDone, 40);
      return () => clearTimeout(t);
    }
    setShown(0);
    setComplete(false);
    actions.current = 0;
    setActionCount(0);
    let i = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const tick = () => {
      if (i < steps.length) {
        const s = steps[i];
        actions.current += 3 + ((s.t || s.ck || '').length % 6);
        setActionCount(actions.current);
        i++;
        setShown(i);
        timers.push(setTimeout(tick, s.ck ? 700 : s.mono ? 340 : 520));
      } else {
        setComplete(true);
        timers.push(setTimeout(onDone, 320));
      }
    };
    timers.push(setTimeout(tick, 40));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps]);

  return (
    <div className="exec">
      <div className="exec-h">
        <span className="spin" />
        <span>{title}</span>
        <span className="ec">Ran {actionCount} actions</span>
      </div>
      <div className="exec-log">
        {steps.slice(0, shown).map((s, i) => {
          const live = i === shown - 1 && !complete;
          if (s.ck)
            return (
              <div className="exec-ck" key={i}>
                <span className="ckd" />
                <span>{s.ck}</span>
              </div>
            );
          if (s.mono)
            return (
              <div className={`wrow mono${live ? ' live' : ''}`} key={i}>
                <span className="wk tk0">›</span>
                <span className="wm" dangerouslySetInnerHTML={{ __html: s.t || '' }} />
              </div>
            );
          return (
            <div className={`wrow${live ? ' live' : ''}`} key={i}>
              <span className="wk">{live ? '' : '✓'}</span>
              <span>{s.t}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The finished log as a static record (all steps ✓, no animation / spinner / header) —
// used by the inline card's "What byte did" toggle.
export function StaticLog({ steps }: { steps: LogStep[] }) {
  return (
    <div className="exec-log static">
      {steps.map((s, i) => {
        if (s.ck)
          return (
            <div className="exec-ck" key={i}>
              <span className="ckd" />
              <span>{s.ck}</span>
            </div>
          );
        if (s.mono)
          return (
            <div className="wrow mono" key={i}>
              <span className="wk tk0">›</span>
              <span className="wm" dangerouslySetInnerHTML={{ __html: s.t || '' }} />
            </div>
          );
        return (
          <div className="wrow" key={i}>
            <span className="wk">✓</span>
            <span>{s.t}</span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Delete the modal's local `ExecLog` and import the shared one**

In `components/artifact/ArtifactModal.tsx`:

1. Delete the entire local `ExecLog` function (the block `/* streaming execute log */` … through its closing `}`, currently lines ~59–133).
2. Add to the imports at the top (after the existing `./viewers` import, line 8):

```tsx
import { ExecLog } from './ExecLog';
```

3. At the modal's usage (currently line ~473) the cast is no longer needed — `title` is now `ReactNode`. Change:

```tsx
        <ExecLog
          key={execKind}
          steps={steps}
          title={title as unknown as string}
          onDone={() => {
```

to:

```tsx
        <ExecLog
          key={execKind}
          steps={steps}
          title={title}
          onDone={() => {
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS. `npm run typecheck` shows only the 2 pre-existing `firestore.rules.test.ts` errors (missing `@firebase/rules-unit-testing` dev dep) — baseline, confirm no NEW errors. Do NOT run `next build` (unreliable in this worktree).

- [ ] **Step 4: Commit**

```bash
git add components/artifact/ExecLog.tsx components/artifact/ArtifactModal.tsx
git commit -m "refactor(artifact): extract shared ExecLog (+StaticLog, reduced-motion) from the modal"
```

---

### Task 3: `ChatMessage.steps` + generate the run's steps in the store

**Files:**
- Modify: `lib/store.tsx` (import ~line 17; `ChatMessage` ~line 49–71; `runTaskInChat` card creation ~line 850–860; `reviseTaskInChat` ~line 905)

**Interfaces:**
- Consumes: `buildLog`, `LogStep` from `./helpers`.
- Produces: `ChatMessage.steps?: LogStep[]` — populated for every inline run and revise.

- [ ] **Step 1: Add the import**

In `lib/store.tsx`, change the helpers import (line 17) from:

```tsx
import { artMeta, artType } from './helpers';
```

to:

```tsx
import { artMeta, artType, buildLog, type LogStep } from './helpers';
```

- [ ] **Step 2: Add the `steps` field to `ChatMessage`**

In the `ChatMessage` interface (ends at line ~71 with the `setup?` field), add before the closing brace:

```tsx
  /** The execute-log steps for this run — streamed live in the card, then kept as the
   * "What byte did" record. Generated once (buildLog) when the run starts. */
  steps?: LogStep[];
```

- [ ] **Step 3: Attach steps when the inline run starts**

In `runTaskInChat`, the card is created at lines ~850–860. Change the pushed message object from:

```tsx
        {
          id: msgId,
          role: 'byte',
          text: '',
          ts: Date.now(),
          running: true,
          result: { deptK, taskTitle, type },
        },
```

to (add the `steps` line):

```tsx
        {
          id: msgId,
          role: 'byte',
          text: '',
          ts: Date.now(),
          running: true,
          steps: buildLog(t, type, d),
          result: { deptK, taskTitle, type },
        },
```

- [ ] **Step 4: Regenerate steps on revise**

In `reviseTaskInChat` (line ~905), change the "mark running" update from:

```tsx
      setChatMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, running: true } : m)));
```

to (regenerate steps so the log re-streams for the revise pass):

```tsx
      setChatMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, running: true, steps: buildLog(t, type, d) } : m)),
      );
```

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS (only the 2 baseline `firestore.rules.test.ts` errors; no new). `t`, `type`, and `d` are all already in scope at both edit sites.

- [ ] **Step 6: Commit**

```bash
git add lib/store.tsx
git commit -m "feat(store): generate + carry the run's execute-log steps on the chat message"
```

---

### Task 4: `ResultCard` — stream the log, dual-gate, and the "What byte did" record

**Files:**
- Modify: `components/Copilot.tsx` (imports ~line 1–8; `ResultCard` ~line 51–157)
- Modify: `app/globals.css` (add near the `.cres` block, which starts at line ~2950)

**Interfaces:**
- Consumes: `ExecLog`, `StaticLog` from `./artifact/ExecLog`; `stepCountLabel` from `@/lib/helpers`; `ChatMessage.steps` (Task 3).
- Produces: the three-phase inline card (running log → produced with record + review → approved with record + saved).

- [ ] **Step 1: Add imports**

In `components/Copilot.tsx`, after the existing `import { Byte } from './Byte';` (line 7), add:

```tsx
import { ExecLog, StaticLog } from './artifact/ExecLog';
import { stepCountLabel } from '@/lib/helpers';
```

- [ ] **Step 2: Rewrite `ResultCard`**

Replace the whole `ResultCard` function (currently lines ~51–157, from `function ResultCard({ m }: { m: ChatMessage }) {` through its closing `}`) with:

```tsx
function ResultCard({ m }: { m: ChatMessage }) {
  const { reviseTaskInChat, approveChatResult, openChatResult } = useApp();
  const [revising, setRevising] = useState(false);
  const [note, setNote] = useState('');
  const [reviseBusy, setReviseBusy] = useState(false);
  // Dual-gate: the card leaves the run view only when the produce is done (m.running=false)
  // AND the log has played through (logDone). Reset whenever a new run/revise starts.
  const [logDone, setLogDone] = useState(false);
  // Latches true only once this card has actually been in flight this session, so a
  // completed/saved result loaded from persistence never re-streams its log on reload.
  const [ran, setRan] = useState(false);
  // The persistent "What byte did" record is collapsed by default.
  const [showRecord, setShowRecord] = useState(false);
  useEffect(() => {
    if (m.running) {
      setRan(true);
      setLogDone(false);
    }
  }, [m.running]);

  const r = m.result!;
  const d = DEPTS.find((x) => x.k === r.deptK);
  const t = d?.tasks.find((x) => x.t === r.taskTitle);
  const noun = TYPE_NOUN[r.type] || 'Deliverable';
  const preview = (t?.out || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const steps = m.steps;
  const hasSteps = !!steps?.length;

  const revise = (text: string) => {
    reviseTaskInChat(m.id, r.deptK, r.taskTitle, text);
    setRevising(false);
    setReviseBusy(true);
    setNote('');
  };

  // Show the run view while producing, or — once a run has started this session — until
  // the log finishes playing. A reloaded, already-done card (ran=false) skips straight to
  // the result, so logs never re-stream on reload.
  const running = m.running || (ran && hasSteps && !logDone);

  return (
    <div className="cres">
      <div className="cres-h">
        <span className="cres-t">{r.taskTitle}</span>
        <span className="cres-tag">
          {d?.name ? `${d.name} · ` : ''}
          {noun}
        </span>
      </div>
      {running ? (
        hasSteps ? (
          <ExecLog
            steps={steps!}
            title={reviseBusy ? 'byte is revising…' : 'byte is doing the work…'}
            onDone={() => setLogDone(true)}
          />
        ) : (
          <div className="cres-run">
            <span className="cres-spin" />
            {reviseBusy ? 'Revising…' : 'Producing…'}
          </div>
        )
      ) : (
        <>
          {hasSteps && (
            <div className="cres-rec">
              <button
                className="cres-rec-t"
                onClick={() => setShowRecord((v) => !v)}
                aria-expanded={showRecord}
              >
                {showRecord ? '▾' : '▸'} What byte did · {stepCountLabel(steps!)}
              </button>
              {showRecord && <StaticLog steps={steps!} />}
            </div>
          )}
          {preview && <div className="cres-prev">{preview}</div>}
          {r.approved ? (
            <div className="cres-saved">Saved to your library</div>
          ) : revising ? (
            <div className="cres-rev">
              <div className="cres-rev-chips">
                {REVISE_CHIPS.map((c) => (
                  <button key={c} className="cres-chip" onClick={() => revise(c)}>
                    {c}
                  </button>
                ))}
              </div>
              <div className="cres-rev-row">
                <input
                  className="cres-rev-in"
                  autoFocus
                  placeholder="Tell byte what to change…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      revise(note);
                    } else if (e.key === 'Escape') {
                      setRevising(false);
                      setNote('');
                    }
                  }}
                />
                <button
                  className="cres-rev-go"
                  aria-label="Send revision"
                  onClick={() => revise(note)}
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M2 8h11M9 4l4 4-4 4"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            </div>
          ) : (
            <div className="cres-acts">
              <button
                className="cres-b primary"
                onClick={() => approveChatResult(r.deptK, r.taskTitle)}
              >
                Approve
              </button>
              <button className="cres-b" onClick={() => openChatResult(r.deptK, r.taskTitle)}>
                {r.type === 'site' ? 'Open' : 'Read'}
              </button>
              <button className="cres-b" onClick={() => setRevising(true)}>
                Revise
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

_(This is the current `ResultCard` verbatim with these additions: the `logDone`/`ran`/`showRecord` state + the `m.running` effect, the `steps`/`hasSteps`/`running` derivations, the `ExecLog` branch in the run view, and the `cres-rec` record block. The Approve/Read/Revise and revise-input branches are unchanged.)_

- [ ] **Step 3: Add the CSS**

In `app/globals.css`, immediately after the `.cres-saved { … }` rule (ends around line 3040), add:

```css
/* inline execute log — reuse the modal's .exec styling, sized for the chat card */
.cres .exec {
  margin-top: 12px;
}
.cres .exec-log {
  font-size: 12px;
}
/* the persistent "What byte did" record on a produced/saved card */
.cres-rec {
  margin-top: 12px;
}
.cres-rec-t {
  font-family: var(--sans);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--t-3);
  background: var(--surface-2, #f7f5fc);
  border: 1px solid var(--hairline);
  border-radius: 8px;
  padding: 6px 10px;
  cursor: pointer;
  transition: 0.15s;
}
.cres-rec-t:hover {
  color: var(--accent-deep);
}
.cres-rec .exec-log.static {
  margin-top: 9px;
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS (only the 2 baseline `firestore.rules.test.ts` errors; no new).

- [ ] **Step 5: Full test suite**

Run: `npm run test`
Expected: green, including `lib/helpers.test.ts` from Task 1.

- [ ] **Step 6: Manual verification (deferred to the Vercel PR preview)**

_Not runnable in this worktree (`next build`/`next dev` unreliable). Record as the preview checklist:_ run a task from chat → the card streams byte's steps with the "Ran N actions" counter → it settles into a collapsed **"▸ What byte did · N steps"** toggle **above** the preview + **Approve / Read / Revise** (still gated, nothing auto-saved) → tap the toggle to re-open the steps → **Approve** → "Saved to your library" with the record still present → **Revise** re-streams a fresh log → the deliverable **modal**'s execute log is unchanged → toggle `prefers-reduced-motion` and confirm the log appears instantly → force a produce failure and confirm the error text shows with no success log.

- [ ] **Step 7: Commit**

```bash
git add components/Copilot.tsx app/globals.css
git commit -m "feat(chat): watch byte work inline, then a re-openable \"What byte did\" record"
```

---

## Notes for the executor

- **Worktree limits:** `next build`/`next dev` are unreliable here (symlinked `node_modules`, concurrent-session branch flips). Typecheck / lint / `npm run test` DO run locally and are the per-task gates; all visual behavior verifies on the Vercel PR preview.
- **Commit ≠ merged ≠ deployed.** Reaches prod only after the PR merges into `main` and Vercel redeploys (prod project `codepet-v1-2`).
- **Baseline:** `npm run typecheck` shows exactly 2 pre-existing `firestore.rules.test.ts` errors (missing `@firebase/rules-unit-testing`) — environmental, unrelated; confirm the count is unchanged rather than newly introduced.
