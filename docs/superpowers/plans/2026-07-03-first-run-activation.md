# First-Run Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make byte's company-building visible inside the onboarding wizard and hand the founder one irresistible first action, so the first session *demonstrates* the draft→approve loop (activation = witness a real deliverable, then approve it).

**Architecture:** The wizard's fake "analysis" step (step 6) is replaced with the *real* `scaffoldCompany` call; the summary (step 7) reads the freshly-built `DEPTS` singleton to show the actual company; on landing, byte seeds a first-run greeting in chat offering the real `nextStep` as a one-tap **inline** action that produces a deliverable in-thread (with the existing Approve card). Scaffold logic is touched only by being awaited — no change to generation, keeping this clear of the concurrent `feat/project-model` work.

**Tech Stack:** Next.js 16 App Router / React 19 / TypeScript, Vitest for unit tests, the existing `track()` analytics façade, Firebase (untouched here).

## Global Constraints

- Work only in the worktree `/private/tmp/claude-501/-Users-monatruong/d31cb161-d475-4451-86b0-aea1ff23a43b/scratchpad/wt-activation` on branch `feat/first-run-activation`. Never touch the main checkout at `~/Desktop/Codepet v1.2` (a concurrent session owns it).
- Do **not** modify `lib/ai/scaffold.ts`, `app/api/scaffold/**`, or any `project-model` / grounding code — only *call* `scaffoldCompany`.
- Model for any Claude call stays `claude-opus-4-8` (unchanged — no new API calls added).
- No decorative icons/emojis in new UI copy; minimalist tone; no decorative arrows (`->`). byte writes plain text.
- eslint rule `react-hooks/set-state-in-effect`: never call a state setter *synchronously* in a `useEffect` body. Setters inside `setTimeout`/`.then()` callbacks are fine (the existing step-6 effect already does this).
- The pre-push gate (run from the worktree) must be green: `./node_modules/.bin/prettier --check .` , `./node_modules/.bin/tsc --noEmit` (ignore pre-existing `firestore.rules.test.ts` errors), `./node_modules/.bin/eslint .` (exit 0), `./node_modules/.bin/vitest run`.
- Commit after each task. Do **not** push or open a PR until the user asks.

---

### Task 1: Pure first-run helpers (`lib/onboarding/firstRun.ts`)

Self-contained, fully unit-tested pure functions the wizard and store consume. No React, no I/O.

**Files:**
- Create: `lib/onboarding/firstRun.ts`
- Test: `lib/onboarding/firstRun.test.ts`

**Interfaces:**
- Consumes: `Dept` from `../data`, `NextStep` from `../ai/nextStep`, `CompanyBrief` from `../firebase/schema`.
- Produces:
  - `interface RevealSummary { ok: boolean; deptCount: number; taskCount: number; sampleDepts: string[]; sampleTasks: string[]; }`
  - `buildRevealSummary(depts: Dept[], ok: boolean): RevealSummary`
  - `interface FirstRunGreeting { text: string; action?: { label: string; deptK: string; taskTitle: string; inline: true }; }`
  - `buildFirstRunGreeting(brief: CompanyBrief, nextStep: NextStep | null): FirstRunGreeting`

- [ ] **Step 1: Write the failing test**

Create `lib/onboarding/firstRun.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildRevealSummary, buildFirstRunGreeting } from './firstRun';
import type { Dept } from '../data';

const dept = (k: string, name: string, tasks: Array<[string, boolean]>, later = false): Dept => ({
  k,
  name,
  ab: name.slice(0, 2).toUpperCase(),
  status: 'attention',
  pend: 0,
  need: '',
  byte: '',
  later,
  tasks: tasks.map(([t, done]) => ({ t, who: 'you', out: '', done })),
});

describe('buildRevealSummary', () => {
  const depts: Dept[] = [
    dept('eng', 'Engineering', [['Ship the beta', false], ['Old thing', true]]),
    dept('mkt', 'Marketing', [['Draft the landing page', false]]),
    dept('legal', 'Legal', [['Privacy policy', false]]),
    dept('fin', 'Finance', [['Pricing model', false]]),
    dept('later', 'Growth', [['Referral loop', false]], true), // dormant — excluded
  ];

  it('counts only active (non-later) departments and open tasks', () => {
    const s = buildRevealSummary(depts, true);
    expect(s.ok).toBe(true);
    expect(s.deptCount).toBe(4); // 'Growth' is later → excluded
    expect(s.taskCount).toBe(4); // open tasks across active depts (the 'Old thing' done task excluded)
  });

  it('samples up to 3 department names and 3 first-open task titles', () => {
    const s = buildRevealSummary(depts, true);
    expect(s.sampleDepts).toEqual(['Engineering', 'Marketing', 'Legal']);
    expect(s.sampleTasks).toEqual(['Ship the beta', 'Draft the landing page', 'Privacy policy']);
  });

  it('carries the ok flag through (scaffold-failed reveal still returns seed-derived numbers)', () => {
    const s = buildRevealSummary(depts, false);
    expect(s.ok).toBe(false);
    expect(s.deptCount).toBe(4);
  });
});

describe('buildFirstRunGreeting', () => {
  const ns = { deptK: 'mkt', taskTitle: 'Draft the landing page', why: '' };

  it('addresses the founder, names the project, and offers an inline action', () => {
    const g = buildFirstRunGreeting({ founderName: 'Mona', projectName: 'Codepet' }, ns);
    expect(g.text).toContain('Mona');
    expect(g.text).toContain('Codepet');
    expect(g.text).toContain('Draft the landing page');
    expect(g.action).toEqual({
      label: 'Do it with me: Draft the landing page',
      deptK: 'mkt',
      taskTitle: 'Draft the landing page',
      inline: true,
    });
  });

  it('falls back to a warm nudge with no action when there is no next step', () => {
    const g = buildFirstRunGreeting({ projectName: 'Codepet' }, null);
    expect(g.action).toBeUndefined();
    expect(g.text).toContain('Codepet');
    expect(g.text.length).toBeGreaterThan(0);
  });

  it('handles a missing founder name gracefully', () => {
    const g = buildFirstRunGreeting({ projectName: 'Codepet' }, ns);
    expect(g.text).not.toContain('undefined');
    expect(g.action?.inline).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd <worktree> && ./node_modules/.bin/vitest run lib/onboarding/firstRun.test.ts`
Expected: FAIL — `Cannot find module './firstRun'`.

- [ ] **Step 3: Write the implementation**

Create `lib/onboarding/firstRun.ts`:

```ts
// Pure helpers for the first-run activation arc: turn the freshly scaffolded company
// into a reveal summary (shown in the wizard's final step) and build byte's landing
// greeting with a one-tap inline action. No React, no I/O — unit-tested in isolation.
import type { Dept } from '../data';
import type { NextStep } from '../ai/nextStep';
import type { CompanyBrief } from '../firebase/schema';

export interface RevealSummary {
  /** True when the real scaffold produced a company (vs. the seed fallback). */
  ok: boolean;
  /** Active (non-dormant) departments. */
  deptCount: number;
  /** Open tasks across the active departments. */
  taskCount: number;
  /** Up to 3 active department names, for the reveal. */
  sampleDepts: string[];
  /** Up to 3 first-open task titles, for the reveal. */
  sampleTasks: string[];
}

export function buildRevealSummary(depts: Dept[], ok: boolean): RevealSummary {
  const active = depts.filter((d) => !d.later);
  const openTasks = active.flatMap((d) => d.tasks.filter((t) => !t.done));
  const sampleTasks = active
    .map((d) => d.tasks.find((t) => !t.done)?.t)
    .filter((t): t is string => Boolean(t))
    .slice(0, 3);
  return {
    ok,
    deptCount: active.length,
    taskCount: openTasks.length,
    sampleDepts: active.slice(0, 3).map((d) => d.name),
    sampleTasks,
  };
}

export interface FirstRunGreeting {
  text: string;
  action?: { label: string; deptK: string; taskTitle: string; inline: true };
}

export function buildFirstRunGreeting(
  brief: CompanyBrief,
  nextStep: NextStep | null,
): FirstRunGreeting {
  const who = brief.founderName?.trim();
  const proj = brief.projectName?.trim() || 'your product';
  const lead = who ? `${who}, your company for ${proj} is ready.` : `Your company for ${proj} is ready.`;
  if (!nextStep) {
    return {
      text: `${lead} Take a look around — open any department to see what I've lined up, and I'll produce the work with you whenever you're ready.`,
    };
  }
  return {
    text: `${lead} The best first move is “${nextStep.taskTitle}”. Want me to do it with you, right here? I'll draft it and you approve — nothing ships without your say-so.`,
    action: {
      label: `Do it with me: ${nextStep.taskTitle}`,
      deptK: nextStep.deptK,
      taskTitle: nextStep.taskTitle,
      inline: true,
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd <worktree> && ./node_modules/.bin/vitest run lib/onboarding/firstRun.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd <worktree>
git add lib/onboarding/firstRun.ts lib/onboarding/firstRun.test.ts
git commit -m "feat(activation): pure first-run reveal + greeting builders"
```

---

### Task 2: Inline chat action + first-approve tracking

The greeting's action must produce the deliverable **inline** (`runTaskInChat`), not open the modal (`runBriefedTask`). Add an `inline` discriminator to the chat `action` and branch on it. Also fire the `firstrun.first_approve` funnel event (once) when the first inline result is approved.

**Files:**
- Modify: `lib/store.tsx` (the `ChatMessage.action` type; `approveChatResult`)
- Modify: `components/Copilot.tsx` (the `m.action` onClick branch)

**Interfaces:**
- Consumes: `runTaskInChat(deptK, taskTitle)` and `runBriefedTask(deptK, taskTitle)` (existing store actions); `track` from `lib/analytics` (already imported in store).
- Produces: `ChatMessage.action` now optionally carries `inline?: boolean`. When `inline` is true, the Copilot chip calls `runTaskInChat`.

- [ ] **Step 1: Extend the `action` type in `lib/store.tsx`**

Find the `ChatMessage` interface (the `action?` field) and replace it:

```ts
  /** An optional one-tap action byte offers in-chat (e.g. "Start: <task>").
   * `inline: true` ⇒ produce the deliverable in-thread (runTaskInChat) instead of
   * opening the department run modal (runBriefedTask). */
  action?: { label: string; deptK: string; taskTitle: string; inline?: boolean };
```

- [ ] **Step 2: Branch the chip onClick in `components/Copilot.tsx`**

Find (around line 242–247):

```tsx
              {m.action && (
                <button
                  className="chip start"
                  onClick={() => runBriefedTask(m.action!.deptK, m.action!.taskTitle)}
                >
                  {m.action.label}
                </button>
              )}
```

Replace the `onClick` with an inline-aware branch (and track the first-run click):

```tsx
              {m.action && (
                <button
                  className="chip start"
                  onClick={() => {
                    if (m.action!.inline) {
                      track('firstrun.action_clicked', { dept: m.action!.deptK });
                      runTaskInChat(m.action!.deptK, m.action!.taskTitle);
                    } else {
                      runBriefedTask(m.action!.deptK, m.action!.taskTitle);
                    }
                  }}
                >
                  {m.action.label}
                </button>
              )}
```

Add `runTaskInChat` to the `useApp()` destructure near the top of the component (it already destructures `runBriefedTask`), and add the `track` import:

```tsx
import { track } from '@/lib/analytics';
```

Update the destructure line that currently reads `runBriefedTask,` to include `runTaskInChat,`.

- [ ] **Step 3: Fire `firstrun.first_approve` once in `approveChatResult` (`lib/store.tsx`)**

Add a ref near the other refs in `AppProvider` (e.g. beside `toastTimer`):

```ts
  const firstApproveTracked = useRef(false);
```

In `approveChatResult`, after the successful `approveTask(t, d, type)` call, before the `setChatMessages(...)` flip, add:

```ts
      if (!firstApproveTracked.current) {
        firstApproveTracked.current = true;
        track('firstrun.first_approve', { dept: deptK });
      }
```

- [ ] **Step 4: Gate**

Run from the worktree:
```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint components/Copilot.tsx lib/store.tsx
./node_modules/.bin/prettier --check components/Copilot.tsx lib/store.tsx
```
Expected: tsc clean (ignore any pre-existing `firestore.rules.test.ts` error), eslint exit 0, prettier reports "All matched files use Prettier code style" (or run `--write` then re-check).

- [ ] **Step 5: Commit**

```bash
git add lib/store.tsx components/Copilot.tsx
git commit -m "feat(activation): inline chat action + first-approve tracking"
```

---

### Task 3: Real scaffold reveal in the wizard

Replace step 6's fake animation-only screen with the *real* `scaffoldCompany` call, gate the advance on it, and show the actual company in step 7.

**Files:**
- Modify: `lib/store.tsx` (add `scaffoldFromOnboarding`; add `scaffoldedInWizard` ref; expose in context)
- Modify: `components/Onboarding.tsx` (extract `briefFromData`; step-6 real scaffold + gating; step-7 real summary)

**Interfaces:**
- Consumes: `scaffoldCompany` (already imported in store), `buildRevealSummary` + `RevealSummary` from `lib/onboarding/firstRun` (Task 1), `DEPTS` from `lib/data`.
- Produces: `scaffoldFromOnboarding(brief: CompanyBrief): Promise<RevealSummary>` on the store context; `briefFromData(data: ObData): CompanyBrief` (module-local in Onboarding).

- [ ] **Step 1: Add `scaffoldedInWizard` ref + `scaffoldFromOnboarding` to `lib/store.tsx`**

Add the import at the top (near the other `lib/onboarding`/`ai` imports):

```ts
import { buildRevealSummary, type RevealSummary } from './onboarding/firstRun';
```

Add a ref beside the other refs in `AppProvider`:

```ts
  const scaffoldedInWizard = useRef(false);
```

Add the action (place it just above `finishOnboarding`):

```ts
  // Run the real stage-aware scaffold DURING onboarding (the wizard's "analysis" step),
  // so the founder watches byte build their actual company instead of a fake animation.
  // Marks scaffoldedInWizard so finishOnboarding won't run it a second time. Returns a
  // reveal summary read from the now-live DEPTS (ok=false ⇒ generation failed, seed kept).
  const scaffoldFromOnboarding = useCallback(
    async (briefData: CompanyBrief): Promise<RevealSummary> => {
      scaffoldedInWizard.current = true; // we attempted it here; don't double-run in finish
      if (!companyId) return buildRevealSummary(DEPTS, false);
      const changed = await scaffoldCompany(companyId, briefData);
      if (changed > 0) bump();
      return buildRevealSummary(DEPTS, changed > 0);
    },
    [companyId, bump],
  );
```

- [ ] **Step 2: Skip the re-scaffold in `finishOnboarding` when the wizard already ran it**

In `finishOnboarding`, find the `.then(() => { ... scaffoldCompany ... })` block and guard the scaffold on the ref:

```ts
      completeOnboarding(companyId, briefData)
        .then(() => {
          // The wizard's analysis step already scaffolded (the real reveal). Only
          // scaffold here as a fallback when it didn't (e.g. a "skip" with a brief).
          if (!briefData || scaffoldedInWizard.current) return;
          return scaffoldCompany(companyId, briefData).then((changed) => {
            if (changed) bump();
          });
        })
        .catch((err) => console.error('[store] completeOnboarding failed', err));
```

- [ ] **Step 3: Expose `scaffoldFromOnboarding` on the context**

Add to the `AppState` interface (near `finishOnboarding`):

```ts
  /** Run the real scaffold during onboarding's analysis step; returns the reveal summary. */
  scaffoldFromOnboarding: (brief: CompanyBrief) => Promise<RevealSummary>;
```

Add `scaffoldFromOnboarding,` to **both** context-value objects (the memoized value has two occurrences of the field list — add it to each, matching how `finishOnboarding` appears in both).

- [ ] **Step 4: Gate the store changes**

```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint lib/store.tsx
```
Expected: clean. (If tsc flags a missing field in the context value, you missed one of the two value objects — add it there.)

- [ ] **Step 5: Extract `briefFromData` in `components/Onboarding.tsx`**

Add a module-level helper (above the `Onboarding` component), lifting the mapping currently inline in `finish()`:

```tsx
import { buildRevealSummary, type RevealSummary } from '@/lib/onboarding/firstRun';
import { DEPTS } from '@/lib/data';
import type { CompanyBrief } from '@/lib/firebase/schema';

// The wizard's collected answers → the CompanyBrief byte scaffolds + grounds work in.
function briefFromData(data: ObData): CompanyBrief {
  return {
    founderName: data.name || undefined,
    role: data.roleLabel || undefined,
    tech: OB_TECH.find(([, k]) => k === data.tech)?.[0],
    stage: OB_STAGES[data.stage],
    projectName: data.projName || undefined,
    oneLiner: data.oneLiner || undefined,
    notes: data.proj || undefined,
    link: data.link || undefined,
    categories: data.categories.length ? data.categories : undefined,
    audience: data.audience || undefined,
  };
}
```

Then rewrite `finish()` to reuse it:

```tsx
  const finish = () => {
    finishOnboarding(briefFromData(data));
    setTimeout(
      () => toast('Your roadmap is ready — byte mapped your company across your departments.'),
      400,
    );
  };
```

(Note: the toast no longer hardcodes "9 steps across 8 departments".)

- [ ] **Step 6: Kick off the real scaffold in the step-6 effect + hold state**

In the `Onboarding` component, add reveal state and pull the new action from the store:

```tsx
  const { onboarding, finishOnboarding, toast, scaffoldFromOnboarding } = useApp();
  const [reveal, setReveal] = useState<RevealSummary | null>(null);
  const [slow, setSlow] = useState(false);
```

Replace the existing step-6 effect with one that also runs the real scaffold (setters live inside timeouts/`.then`, satisfying the eslint rule):

```tsx
  // step 6: play the analysis animation AND run the real scaffold. "See what I found"
  // unlocks only when both the animation has finished and the scaffold has resolved.
  useEffect(() => {
    if (step !== 6) {
      setAnShown(0);
      setAnDone(false);
      setReveal(null);
      setSlow(false);
      return;
    }
    setAnShown(0);
    setAnDone(false);
    setReveal(null);
    setSlow(false);
    let done = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    AN_LINES.forEach((_, i) => timers.push(setTimeout(() => setAnShown(i + 1), i * 640)));
    timers.push(setTimeout(() => setAnDone(true), AN_LINES.length * 640 + 300));
    // subtle "still working…" affordance if the API runs long
    timers.push(setTimeout(() => { if (!done) setSlow(true); }, AN_LINES.length * 640 + 3000));
    // the real work
    scaffoldFromOnboarding(briefFromData(data)).then((sum) => {
      if (!done) setReveal(sum);
    });
    // hard safety net: never leave the founder stuck on the analysis screen
    timers.push(
      setTimeout(() => {
        if (!done) setReveal(buildRevealSummary(DEPTS, false));
      }, 20000),
    );
    return () => {
      done = true;
      timers.forEach(clearTimeout);
    };
    // data is complete + frozen by step 6; scaffoldFromOnboarding is stable (useCallback)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
```

- [ ] **Step 7: Gate step 6's advance on `anDone && reveal`, with the slow affordance**

In the step-6 `foot` block, change the completion gate from `anDone` to `anDone && reveal`, and surface the "still working" line. Replace the step-6 `foot` assignment:

```tsx
    foot =
      anDone && reveal ? (
        <div className="ob-foot">
          <div className="ob-prog">
            <div className="ob-bar">
              <i style={{ width: `${pct}%` }} />
            </div>
            <span className="rstep">
              Step {step + 1} of {OB_TOTAL}
            </span>
          </div>
          <span className="grow" />
          <button className="btnlg" onClick={() => setStep(7)}>
            See what I found
          </button>
        </div>
      ) : slow ? (
        <div className="ob-foot">
          <span className="rstep">Still building your company…</span>
        </div>
      ) : null;
```

- [ ] **Step 8: Show the real company in step 7**

Replace the hardcoded value rows in the step-7 `else` branch (the "A living roadmap / Real work, done with you / You stay in control" block). Use `reveal` when `ok`, else an honest generic summary:

```tsx
    const rl = (data.roleLabel || 'founder').toLowerCase();
    const r = reveal;
    body = (
      <>
        <h2>Here&apos;s your company{data.name ? ', ' + data.name : ''}.</h2>
        <p>
          You&apos;re a <b>{rl}</b> at the <b>{OB_STAGES[data.stage].toLowerCase()}</b> stage.
          {r && r.ok
            ? ` I built your roadmap and staffed ${r.deptCount} departments — ${r.taskCount} tasks already prepped:`
            : ' I built your roadmap and staffed your departments — here’s what I’ll take off your plate:'}
        </p>
        <div className="val">
          {r && r.ok && r.sampleTasks.length ? (
            r.sampleTasks.map((t) => (
              <div className="vrow" key={t}>
                <div className="vi">✦</div>
                <div>
                  <b>{t}</b>
                </div>
              </div>
            ))
          ) : (
            <>
              <div className="vrow">
                <div className="vi">✦</div>
                <div>
                  <b>A living roadmap</b> — staged from &quot;{OB_STAGES[data.stage]}&quot; to launch.
                </div>
              </div>
              <div className="vrow">
                <div className="vi">✦</div>
                <div>
                  <b>Real work, done with you</b> — tasks prepped across your departments.
                </div>
              </div>
              <div className="vrow">
                <div className="vi">✦</div>
                <div>
                  <b>You stay in control</b> — I draft &amp; build; you approve.
                </div>
              </div>
            </>
          )}
        </div>
      </>
    );
    foot = <Foot label="See my company" onClick={finish} />;
```

- [ ] **Step 9: Fire `firstrun.scaffold_shown` when the real reveal renders**

At the top of the `Onboarding` component add the analytics import:

```tsx
import { track } from '@/lib/analytics';
```

Fire the event as a side effect of the reveal resolving (inside the `.then` from Step 6, right after `setReveal(sum)`):

```tsx
    scaffoldFromOnboarding(briefFromData(data)).then((sum) => {
      if (done) return;
      setReveal(sum);
      if (sum.ok) track('firstrun.scaffold_shown', { depts: sum.deptCount, tasks: sum.taskCount });
    });
```

- [ ] **Step 10: Gate the full change**

```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint components/Onboarding.tsx lib/store.tsx
./node_modules/.bin/prettier --write components/Onboarding.tsx lib/store.tsx && ./node_modules/.bin/prettier --check components/Onboarding.tsx lib/store.tsx
./node_modules/.bin/vitest run
```
Expected: tsc clean, eslint exit 0, prettier clean, all vitest tests pass.

- [ ] **Step 11: Commit**

```bash
git add lib/store.tsx components/Onboarding.tsx
git commit -m "feat(activation): real scaffold reveal in the onboarding wizard"
```

---

### Task 4: First-run landing greeting

On finishing onboarding, byte opens chat and greets the founder by name with the real `nextStep` as a one-tap inline action — the bridge from the reveal (still in the wizard) to the first deliverable (B) and approval (C).

**Files:**
- Modify: `lib/store.tsx` (add `greetFirstRun`; call it from `finishOnboarding`)

**Interfaces:**
- Consumes: `buildFirstRunGreeting` from `lib/onboarding/firstRun` (Task 1); `nextAction` (already imported), `fetchNextStep` (already imported), `toggleCopilot`, `setChatMessages`, `track`; the `action.inline` chip wiring from Task 2.
- Produces: greeting seeding behavior; no new exported symbol required (internal to `AppProvider`).

- [ ] **Step 1: Add the import**

Extend the Task 1 import in `lib/store.tsx`:

```ts
import { buildRevealSummary, buildFirstRunGreeting, type RevealSummary } from './onboarding/firstRun';
```

- [ ] **Step 2: Add `greetFirstRun` (place just below `computeNextStep`)**

Mirrors `computeNextStep`'s pattern: seed instantly from the authored fallback so the greeting is never blank, then upgrade the same message when byte's pick resolves. Setters run inside `.then`, satisfying the eslint rule.

```ts
  // First-run only: byte opens chat and greets the founder by name with the single best
  // first move as a one-tap INLINE action (produces the deliverable in-thread). Seeds
  // immediately from the authored fallback, then upgrades to byte's own pick when
  // /api/next-step resolves — the greeting message updates in place (stable id).
  const greetFirstRun = useCallback(
    (briefData: CompanyBrief) => {
      toggleCopilot(false); // open the chat panel so the greeting is seen
      const gid = newId();
      const seed = (ns: NextStep | null) => {
        const g = buildFirstRunGreeting(briefData, ns);
        setChatMessages((prev) => {
          const msg: ChatMessage = {
            id: gid,
            role: 'byte',
            text: g.text,
            ts: Date.now(),
            action: g.action,
          };
          const i = prev.findIndex((m) => m.id === gid);
          return i === -1 ? [...prev, msg] : prev.map((m) => (m.id === gid ? msg : m));
        });
        if (g.action) track('firstrun.action_offered', { dept: g.action.deptK });
      };
      const fb = nextAction();
      const fallback: NextStep | null = fb
        ? { deptK: fb.dept.k, taskTitle: fb.task.t, why: '' }
        : null;
      setNextStep(fallback);
      seed(fallback);
      if (!fallback) return;
      fetchNextStep()
        .then((pick) => {
          if (pick) {
            setNextStep(pick);
            seed(pick);
          }
        })
        .catch((err) => console.error('[store] greetFirstRun next-step failed', err));
    },
    [toggleCopilot],
  );
```

- [ ] **Step 3: Call `greetFirstRun` from `finishOnboarding`**

`finishOnboarding` already sets the brief in state. Add the greeting call at the end of its body (after the `completeOnboarding(...)` block), passing the brief directly (state is async, so we can't rely on the `brief` closure):

```ts
      if (briefData) greetFirstRun(briefData);
```

Add `greetFirstRun` to `finishOnboarding`'s dependency array.

- [ ] **Step 4: Gate**

```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint lib/store.tsx
./node_modules/.bin/prettier --write lib/store.tsx && ./node_modules/.bin/prettier --check lib/store.tsx
./node_modules/.bin/vitest run
```
Expected: all clean/pass.

- [ ] **Step 5: Commit**

```bash
git add lib/store.tsx
git commit -m "feat(activation): first-run landing greeting with inline first action"
```

---

### Task 5: Full-gate + manual verification checkpoint

No new code — prove the arc end-to-end and that the whole suite is green before handing back.

**Files:** none (verification only).

- [ ] **Step 1: Full clone gate from the worktree**

```bash
cd <worktree>
./node_modules/.bin/prettier --check .
./node_modules/.bin/tsc --noEmit          # ignore ONLY pre-existing firestore.rules.test.ts errors
./node_modules/.bin/eslint .              # must exit 0
./node_modules/.bin/vitest run            # all tests pass
```

- [ ] **Step 2: Manual first-run walkthrough**

Copy `.env.local` from the main checkout into the worktree (gitignored, needed for the dev server), then start the webpack dev server (Turbopack rejects the symlinked `node_modules`):

```bash
cp "/Users/monatruong/Desktop/Codepet v1.2/.env.local" <worktree>/.env.local
cd <worktree> && PORT=3003 ./node_modules/.bin/next dev --webpack
```

In the browser (hand the URL to the user if the shared Chrome fights navigation), sign in with a **fresh/onboarding** account and confirm the arc:
1. Wizard steps 1–5 collect the brief as before.
2. Step 6 shows the analysis lines AND genuinely waits — "See what I found" appears only after the real scaffold resolves (watch for `firstrun.scaffold_shown` in the analytics sink / console).
3. Step 7 shows the **real** department/task names and true counts (not "11 tasks / 9 steps").
4. Landing: chat is open; byte greets by name, names the project, offers "Do it with me: <real task>".
5. Click it → a real deliverable is produced **inline** in chat (**B**) → Approve saves it (**C**). Confirm `firstrun.action_offered` → `action_clicked` → `first_approve` all fired.
6. Slow/timeout path: acceptable if the analysis holds with "Still building your company…" and never dead-ends.

- [ ] **Step 3: Stop the dev server**

```bash
lsof -ti:3003 | xargs kill -9 2>/dev/null || true
```

- [ ] **Step 4: Report**

Summarize the verified arc and the gate result to the user. Do **not** push or open a PR until they ask.

---

## Self-Review

**Spec coverage:**
- Step 6 fake→real scaffold → Task 3 (Steps 6–7). ✓
- Step 7 real company summary → Task 3 (Step 8). ✓
- Landing greeting by name + real nextStep + one action → Task 4. ✓
- First action produces deliverable inline (B) → Task 2 (inline chip) + Task 4. ✓
- Approve (C) → existing `approveChatResult`, funnel event in Task 2. ✓
- `scaffoldCompany` touched only by awaiting → Task 3 (`scaffoldFromOnboarding` calls it, no edits to scaffold.ts). ✓
- `finishOnboarding` stops double-scaffolding → Task 3 (Step 2). ✓
- Copilot open on first arrival → Task 4 (`toggleCopilot(false)`). ✓
- Error/slow paths (scaffold fail = honest generic summary; slow = "still working"; hard timeout; no nextStep = nudge without button) → Task 3 (Steps 6–8) + Task 1 (greeting fallback). ✓
- Unit tests (reveal builder, greeting builder incl. fallbacks) → Task 1. ✓ (Step-6 unlock + store wiring verified via gate + manual — no React test harness exists in this repo.)
- Analytics funnel (scaffold_shown, action_offered, action_clicked, first_approve) → Tasks 2–4. ✓

**Placeholder scan:** No TBD/TODO; every code step carries real code. ✓

**Type consistency:** `RevealSummary`/`buildRevealSummary`/`buildFirstRunGreeting`/`FirstRunGreeting` names identical across Tasks 1, 3, 4. `action.inline?: boolean` defined in Task 2, consumed in Task 4's greeting (`inline: true`) and Copilot branch. `scaffoldFromOnboarding(brief): Promise<RevealSummary>` signature identical in store + context + Onboarding. ✓
