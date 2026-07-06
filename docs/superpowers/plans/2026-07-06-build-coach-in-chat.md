# Build Coach in chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the "Let's build" experience out of its own sidebar tab and into the byte chat: START becomes a scripted-natural conversation in the chat panel, and the live `claude` session (DURING) + recap (END) expand into the main area, reusing the existing Build Coach UI.

**Architecture:** Build-flow state moves from `BuildCoachView` local `useState` into the shared store slice (`AppProvider` in `lib/store.tsx`) so the chat panel and the main view read one source of truth. Pure transition logic is extracted to a framework-free `lib/buildFlow.ts` and unit-tested. The chat drives START (intake → plan → arm); the store owns the `subscribeLiveBuild` subscription and flips the main-view step; `BuildCoachView` shrinks to render only DURING/END from the store.

**Tech Stack:** Next.js (client components), React context store, Firebase (Firestore live doc), vitest (node env, colocated `*.test.ts`), the existing `/api/build-plan` and `/api/build-session/*` routes (unchanged).

## Global Constraints

- Byte's voice: warm, encouraging, emoji-friendly (match existing `BuildCoachView` / chat copy).
- Chat text renders plain (the `plain()` helper strips markdown) — do not rely on markdown in chat bubbles.
- Keep it token-thrifty; do NOT add a new AI-driven intake — the intake questions are a fixed script (one opening + at most one follow-up). Plans are produced by the existing `requestBuildPlan`.
- Do NOT modify `/api/build-plan`, `/api/build-session/*`, `armBuildSession`, `armSession.ts`, `LiveChat.tsx`, or `liveBuild.ts`.
- Tests: vitest, colocated `*.test.ts`, `node` environment (no DOM). Only pure modules get unit tests; React wiring is verified with `npm run typecheck` + `npm run lint` + manual run.
- Prettier-format touched files (CI runs prettier); run `npm run lint` before each commit.
- `'build'` stays in the `View` union and the `AppRoot` switch — it is only entered programmatically from `armBuild()`, never from the sidebar.

---

## File Structure

- **Create** `lib/buildFlow.ts` — pure build-flow helpers (intake copy, brief accumulation, live→step mapping). Framework-free, unit-tested.
- **Create** `lib/buildFlow.test.ts` — vitest unit tests for the above.
- **Modify** `lib/store.tsx` — add the build-flow state slice + actions to `AppState` and `AppProvider`; add `buildPlan`/`buildAction` fields to `ChatMessage`; own the `subscribeLiveBuild` effect.
- **Modify** `components/Copilot.tsx` — empty-state "Let's build" button; route the composer to intake while active; render the plan card + build-action buttons; a live/closing coaching bubble.
- **Modify** `components/views/BuildCoachView.tsx` — remove `StartStep`; render only DURING/END; read all state from the store; drop local `useState`.
- **Modify** `components/Sidebar.tsx` — remove the `{ view: 'build', label: "Let's build" }` nav entry.

---

## Task 1: Pure build-flow module (`lib/buildFlow.ts`)

**Files:**
- Create: `lib/buildFlow.ts`
- Test: `lib/buildFlow.test.ts`

**Interfaces:**
- Consumes: `LiveState` from `./liveBuild`.
- Produces:
  - `type BuildStep = 'during' | 'end'`
  - `const INTAKE_OPENING: string`
  - `const INTAKE_FOLLOWUP: string`
  - `function appendBrief(brief: string, text: string): string`
  - `function stepForLive(live: Pick<LiveState, 'ended'> | null): BuildStep`

- [ ] **Step 1: Write the failing test**

Create `lib/buildFlow.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { appendBrief, stepForLive, INTAKE_OPENING, INTAKE_FOLLOWUP } from './buildFlow';

describe('appendBrief', () => {
  it('starts the brief with the first answer', () => {
    expect(appendBrief('', 'a todo app')).toBe('a todo app');
  });
  it('joins later answers with a newline', () => {
    expect(appendBrief('a todo app', 'for students')).toBe('a todo app\nfor students');
  });
  it('trims each answer and ignores blank ones', () => {
    expect(appendBrief('a todo app', '   ')).toBe('a todo app');
    expect(appendBrief('', '  hi  ')).toBe('hi');
  });
});

describe('stepForLive', () => {
  it('is "during" while the session is live or unknown', () => {
    expect(stepForLive(null)).toBe('during');
    expect(stepForLive({ ended: false })).toBe('during');
  });
  it('is "end" once the session has ended', () => {
    expect(stepForLive({ ended: true })).toBe('end');
  });
});

describe('intake copy', () => {
  it('provides a non-empty opening and follow-up line', () => {
    expect(INTAKE_OPENING.length).toBeGreaterThan(0);
    expect(INTAKE_FOLLOWUP.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/buildFlow.test.ts`
Expected: FAIL — `Cannot find module './buildFlow'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/buildFlow.ts`:

```ts
// Pure, framework-free helpers for the "Let's build" flow that now lives in the
// byte chat. The chat drives START (intake → plan); the store arms the session and
// the main view renders DURING/END. Kept dependency-free so the transitions are
// unit-tested without React or network. See
// docs/superpowers/specs/2026-07-06-build-coach-in-chat-design.md.
import type { LiveState } from './liveBuild';

/** The two main-view steps that survive the move to chat (START is now in chat). */
export type BuildStep = 'during' | 'end';

/** Byte's opening intake question — natural, warm, one question. */
export const INTAKE_OPENING =
  "Ooh, let's build something! Tell me what you have in mind — who's it for, and what does “done” look like? 💭";

/** Byte's single scripted follow-up, shown after the founder's first answer. */
export const INTAKE_FOLLOWUP =
  "Love it! Anything else it must do? Add as much as you like — when you're ready, hit “Turn this into a plan”. 😎";

/** Append one intake answer to the running brief (newline-joined, blank-safe). */
export function appendBrief(brief: string, text: string): string {
  const t = text.trim();
  if (!t) return brief;
  return brief ? `${brief}\n${t}` : t;
}

/** Which main-view step matches the current live state: END once ended, else DURING. */
export function stepForLive(live: Pick<LiveState, 'ended'> | null): BuildStep {
  return live?.ended ? 'end' : 'during';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/buildFlow.test.ts`
Expected: PASS (3 suites).

- [ ] **Step 5: Commit**

```bash
npx prettier --write lib/buildFlow.ts lib/buildFlow.test.ts
git add lib/buildFlow.ts lib/buildFlow.test.ts
git commit -m "feat(build-coach): pure build-flow helpers for the in-chat flow"
```

---

## Task 2: Store build-flow slice (`lib/store.tsx`)

**Files:**
- Modify: `lib/store.tsx` — `ChatMessage` (near line 44), `View` handling, `AppState` interface (near line 84), `AppProvider` state/effects/actions (near line 161+), and the `value`/deps memo (near line 881+).

**Interfaces:**
- Consumes: `appendBrief`, `stepForLive`, `INTAKE_OPENING`, `INTAKE_FOLLOWUP`, `type BuildStep` from `./buildFlow`; `requestBuildPlan` from `./ai/buildPlan`; `buildOpeningPrompt`, `terminalCommand` from `./armSession`; `armBuildSession` from `@/app/actions/build`; `getCapability` from `@/app/actions/install`; `subscribeLiveBuild`, `ensureIngestToken`, `loadProjectDirs` from `./firebase/companyData`; `type BytePlan` from `./ai/plan`; `type LiveState` from `./liveBuild`.
- Produces (new `AppState` members consumed by Task 3 & Task 4):
  - `buildStep: BuildStep`
  - `buildProject: string`; `setBuildProject: (v: string) => void`
  - `buildBrief: string`
  - `buildPlan: BytePlan | null`
  - `buildSessionId: string | null`
  - `buildLive: LiveState | null`
  - `buildLocal: boolean`
  - `buildLaunchCommand: string | null`
  - `buildProjectDir: string`
  - `buildArming: boolean`
  - `buildIntakeActive: boolean`
  - `startBuildIntake: () => void`
  - `addIntakeTurn: (text: string) => void`
  - `generateBuildPlan: () => void`
  - `armBuild: () => void`
  - `resetBuildFlow: () => void`
- Produces (new `ChatMessage` fields consumed by Task 3):
  - `buildPlan?: BytePlan`
  - `buildAction?: { kind: 'to-plan' | 'start-building'; label: string }`

- [ ] **Step 1: Extend `ChatMessage`**

In `lib/store.tsx`, in the `ChatMessage` interface (currently ends at line 59 with `advance?`), add two fields before the closing brace:

```ts
  /** A build plan Byte generated in chat — rendered as a plan card + "Start building". */
  buildPlan?: import('./ai/plan').BytePlan;
  /** A build-flow button Byte offers in chat (turn intake into a plan, or start the session). */
  buildAction?: { kind: 'to-plan' | 'start-building'; label: string };
```

- [ ] **Step 2: Add imports**

At the top of `lib/store.tsx`, alongside the existing imports, add:

```ts
import {
  appendBrief,
  stepForLive,
  INTAKE_OPENING,
  INTAKE_FOLLOWUP,
  type BuildStep,
} from './buildFlow';
import { requestBuildPlan } from './ai/buildPlan';
import { buildOpeningPrompt, terminalCommand } from './armSession';
import { armBuildSession } from '@/app/actions/build';
import { getCapability } from '@/app/actions/install';
import type { BytePlan } from './ai/plan';
import type { LiveState } from './liveBuild';
```

Extend the existing `./firebase/companyData` import to also pull `subscribeLiveBuild`, `ensureIngestToken`, and `loadProjectDirs` (they are already exported from that module — see `BuildCoachView.tsx` imports). If `persistChatMessage` etc. are imported from there, add the three names to the same import list.

- [ ] **Step 3: Add build-flow state to `AppState`**

In the `AppState` interface (near line 84), add the members listed in this task's **Produces** block (both the `build*` state fields and the five actions plus `setBuildProject`). Place them after the chat members (`sendChat`, etc.) for locality. Use the exact names/types from **Produces**.

- [ ] **Step 4: Add build-flow state hooks in `AppProvider`**

In `AppProvider` (after the chat state near line 208), add:

```ts
  // "Let's build" flow (was BuildCoachView local state; lifted here so the chat
  // panel drives START and the main view renders DURING/END from one source).
  const [buildStep, setBuildStep] = useState<BuildStep>('during');
  const [buildProject, setBuildProject] = useState('');
  const [buildBrief, setBuildBrief] = useState('');
  const [buildPlan, setBuildPlanState] = useState<BytePlan | null>(null);
  const [buildSessionId, setBuildSessionId] = useState<string | null>(null);
  const [buildLive, setBuildLive] = useState<LiveState | null>(null);
  const [buildLocal, setBuildLocal] = useState(false);
  const [buildLaunchCommand, setBuildLaunchCommand] = useState<string | null>(null);
  const [buildProjectDir, setBuildProjectDir] = useState('');
  const [buildArming, setBuildArming] = useState(false);
  const [buildIntakeActive, setBuildIntakeActive] = useState(false);
  // Guards the one-time "session ended" nudge so the live subscription posts it once.
  const buildEndedNudged = useRef(false);
```

(Confirm `useRef` is imported from `react` at the top; add it if missing.)

- [ ] **Step 5: Own the live subscription in the provider**

Add this effect in `AppProvider` (after the state above):

```ts
  // Subscribe to the live build doc once a session is armed. Updating state from the
  // subscription is intended; when the rollup marks the doc ended we flip to END and
  // post one closing nudge in chat.
  useEffect(() => {
    if (!companyId || !buildSessionId) return;
    return subscribeLiveBuild(companyId, buildSessionId, (s) => {
      setBuildLive(s);
      setBuildStep(stepForLive(s));
      if (s?.ended && !buildEndedNudged.current) {
        buildEndedNudged.current = true;
        setChatMessages((prev) => [
          ...prev,
          {
            id: newId(),
            role: 'byte',
            text: "Nice — your session wrapped up! Pop over to the recap and let's write down what we learned. 📒",
            ts: Date.now(),
          },
        ]);
      }
    });
  }, [companyId, buildSessionId]);
```

- [ ] **Step 6: Add the five build-flow actions**

Add these `useCallback`s in `AppProvider` (place them near `sendChat`, before the `value` memo):

```ts
  const startBuildIntake = useCallback(() => {
    setBuildIntakeActive(true);
    setBuildBrief('');
    setBuildPlanState(null);
    setChatMessages((prev) => [
      ...prev,
      { id: newId(), role: 'byte', text: INTAKE_OPENING, ts: Date.now() },
    ]);
    track('build.intake.start', {});
  }, []);

  const addIntakeTurn = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      const first = buildBrief.trim().length === 0;
      setBuildBrief((b) => appendBrief(b, text));
      const now = Date.now();
      setChatMessages((prev) => [
        ...prev,
        { id: newId(), role: 'me', text, ts: now },
        // After the first answer, Byte nudges once and surfaces the "to plan" button.
        {
          id: newId(),
          role: 'byte',
          text: first ? INTAKE_FOLLOWUP : 'Got it — added. 👍',
          ts: now + 1,
          buildAction: { kind: 'to-plan', label: 'Turn this into a plan →' },
        },
      ]);
    },
    [buildBrief],
  );

  const generateBuildPlan = useCallback(() => {
    const brief = buildBrief.trim();
    if (!brief) return;
    const thinkingId = newId();
    setChatMessages((prev) => [
      ...prev,
      { id: thinkingId, role: 'byte', text: 'Byte is turning this into a plan…', ts: Date.now() },
    ]);
    (async () => {
      try {
        const plan = await requestBuildPlan({ brief, project: buildProject || undefined });
        setBuildPlanState(plan);
        setBuildIntakeActive(false);
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === thinkingId
              ? {
                  ...m,
                  text: `Here's the plan — aim for ~${plan.budgetActions} actions.`,
                  buildPlan: plan,
                  buildAction: { kind: 'start-building', label: 'Start building' },
                }
              : m,
          ),
        );
      } catch {
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === thinkingId
              ? { ...m, text: "Byte couldn't put the plan together just now. Give it another go?" }
              : m,
          ),
        );
      }
    })();
  }, [buildBrief, buildProject]);

  const armBuild = useCallback(() => {
    if (!buildPlan || !companyId || buildArming) return;
    setBuildArming(true);
    buildEndedNudged.current = false;
    (async () => {
      try {
        const id = crypto.randomUUID();
        const dirs = await loadProjectDirs(companyId);
        const dir =
          dirs.find((p) => p.name === buildProject)?.path ?? (buildProject.trim() || '.');
        setBuildProjectDir(dir);
        const cap = await getCapability();
        if (cap.mode === 'local') {
          setBuildLocal(true);
          setBuildLaunchCommand(null);
          setBuildSessionId(id);
          setBuildLive(null);
          setBuildStep('during');
        } else {
          setBuildLocal(false);
          const command = terminalCommand(dir, buildOpeningPrompt(buildPlan, buildBrief));
          const token = await ensureIngestToken(companyId);
          const res = await armBuildSession({
            buildSessionId: id,
            projectDir: dir,
            plan: buildPlan,
            brief: buildBrief,
            companyId,
            token,
            apiUrl: window.location.origin,
          });
          setBuildLaunchCommand(res.ok && res.launched ? null : command);
          setBuildSessionId(id);
          setBuildLive(null);
          setBuildStep('during');
        }
        setView('build');
        setChatMessages((prev) => [
          ...prev,
          {
            id: newId(),
            role: 'byte',
            text: "We're live! I'm watching your session in the main panel — every step lands there. 👀",
            ts: Date.now(),
          },
        ]);
        track('build.arm', {});
      } finally {
        setBuildArming(false);
      }
    })();
  }, [buildPlan, companyId, buildArming, buildProject, buildBrief]);

  const resetBuildFlow = useCallback(() => {
    setBuildStep('during');
    setBuildProject('');
    setBuildBrief('');
    setBuildPlanState(null);
    setBuildSessionId(null);
    setBuildLive(null);
    setBuildLocal(false);
    setBuildLaunchCommand(null);
    setBuildProjectDir('');
    setBuildIntakeActive(false);
    buildEndedNudged.current = false;
  }, []);
```

(If `track(...)` is not the helper name used elsewhere in the file, match the existing telemetry call — e.g. the `track('chat.send', {})` on line 802. Reuse that exact import/name.)

- [ ] **Step 7: Expose everything on the context value**

In the `value = useMemo<AppState>(...)` object (near line 881) add all new members:

```ts
      buildStep,
      buildProject,
      setBuildProject,
      buildBrief,
      buildPlan,
      buildSessionId,
      buildLive,
      buildLocal,
      buildLaunchCommand,
      buildProjectDir,
      buildArming,
      buildIntakeActive,
      startBuildIntake,
      addIntakeTurn,
      generateBuildPlan,
      armBuild,
      resetBuildFlow,
```

Add the same identifiers to the `useMemo` dependency array (the second argument, near line 929).

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors). Fix any missing-import or type mismatches until clean.

- [ ] **Step 9: Run the full unit suite (nothing should break)**

Run: `npm test`
Expected: PASS (existing suites + Task 1's `buildFlow.test.ts`).

- [ ] **Step 10: Commit**

```bash
npx prettier --write lib/store.tsx
npm run lint
git add lib/store.tsx
git commit -m "feat(build-coach): lift build-flow state + actions into the store"
```

---

## Task 3: Chat drives START + plan card (`components/Copilot.tsx`)

**Files:**
- Modify: `components/Copilot.tsx` — `useApp()` destructure, composer `submit`, message rendering (near line 219), empty-state block (line 254).

**Interfaces:**
- Consumes from the store (Task 2): `buildIntakeActive`, `startBuildIntake`, `addIntakeTurn`, `generateBuildPlan`, `armBuild`, `buildArming`, and the `ChatMessage` fields `buildPlan` / `buildAction`.
- Produces: no new exports; UI wiring only.

- [ ] **Step 1: Pull the build-flow API from the store**

In `Copilot()`'s `useApp()` destructure, add:

```ts
  const {
    // ...existing...
    buildIntakeActive,
    startBuildIntake,
    addIntakeTurn,
    generateBuildPlan,
    armBuild,
    buildArming,
  } = useApp();
```

- [ ] **Step 2: Route the composer to intake while active**

Find the composer `submit` handler (the one that calls `sendChat`) and branch on `buildIntakeActive`:

```ts
  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    if (buildIntakeActive) {
      addIntakeTurn(text);
    } else {
      sendChat(text);
    }
    setDraft('');
  };
```

(Match the existing `submit` body; only add the `buildIntakeActive` branch. Keep the existing `chatStreaming`/guard behavior for the `sendChat` path.)

- [ ] **Step 3: Render the plan card + build-action buttons**

In the `chatMessages.map(...)` render (near line 219), add handling BEFORE the generic bubble return. Add a `buildPlan`/`buildAction` branch:

```tsx
          if (m.buildPlan) {
            return (
              <div key={m.id} className="bub">
                {plain(m.text)}
                <div className="cop-plan">
                  <div className="cop-plan-h">{m.buildPlan.title}</div>
                  <ol>
                    {m.buildPlan.steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                </div>
                {m.buildAction?.kind === 'start-building' && (
                  <button className="bub-act" onClick={armBuild} disabled={buildArming}>
                    {buildArming ? 'Opening your session…' : m.buildAction.label}
                  </button>
                )}
              </div>
            );
          }
          if (m.buildAction?.kind === 'to-plan') {
            return (
              <div key={m.id} className="bub">
                {plain(m.text)}
                <button className="bub-act" onClick={generateBuildPlan}>
                  {m.buildAction.label}
                </button>
              </div>
            );
          }
```

- [ ] **Step 4: Add the "Let's build" button to the empty state**

In the `{empty && (...)}` block (line 254), add a primary build button above the CHIPS:

```tsx
        {empty && (
          <div className="chips">
            <button
              className="sug sug-build"
              onClick={startBuildIntake}
              disabled={chatStreaming}
            >
              🔨 Let&apos;s build something
            </button>
            {CHIPS.map((t) => (
              <button key={t} className="sug" onClick={() => sendChat(t)} disabled={chatStreaming}>
                {t}
              </button>
            ))}
          </div>
        )}
```

- [ ] **Step 5: Minimal styles for the plan card + build chip**

In `app/globals.css`, near the copilot block (search `/* ===== copilot ===== */`, ~line 2702), append:

```css
.cop-plan {
  margin-top: 8px;
  padding: 8px 10px;
  border: 1px solid var(--hairline);
  border-radius: 10px;
  background: var(--surface);
}
.cop-plan-h {
  font-weight: 600;
  margin-bottom: 4px;
}
.cop-plan ol {
  margin: 0;
  padding-left: 18px;
}
.sug-build {
  font-weight: 600;
}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
npx prettier --write components/Copilot.tsx app/globals.css
npm run lint
git add components/Copilot.tsx app/globals.css
git commit -m "feat(build-coach): start builds from the chat empty-state + plan card"
```

---

## Task 4: Shrink `BuildCoachView` to DURING/END from the store

**Files:**
- Modify: `components/views/BuildCoachView.tsx` — remove `StartStep`, remove local `useState`, read the store, render DURING/END only.

**Interfaces:**
- Consumes from the store (Task 2): `buildStep`, `buildPlan`, `buildLive`, `buildLaunchCommand`, `buildLocal`, `buildSessionId`, `buildProjectDir`, `buildBrief`, `resetBuildFlow`, and `companyId` from `useAuth()`.
- Produces: `BuildCoachView` (unchanged export) now rendering only DURING/END.

- [ ] **Step 1: Delete the START pieces**

Remove the `StartStep` function (lines ~74–182) and the `'start'` handling. Update `Step`/`STEPS`/`RAIL`/`NEXT_LABEL` to cover only `during`/`end`:

```ts
type Step = 'during' | 'end';
const RAIL: Array<{ key: Step; label: string }> = [
  { key: 'during', label: 'DURING' },
  { key: 'end', label: 'END' },
];
const NEXT_LABEL: Record<Step, string> = {
  during: 'Wrap up →',
  end: 'Start over ↺',
};
```

Keep `DuringStep`, `EndStep`, and `CoachBubble` as-is (their prop shapes don't change).

- [ ] **Step 2: Rewrite the `BuildCoachView` component to read the store**

Replace the component body so it pulls state from the store instead of local `useState` and the local `startBuild`/subscription (those now live in the store from Task 2):

```tsx
export function BuildCoachView() {
  const { companyId } = useAuth();
  const {
    buildStep,
    buildPlan,
    buildLive,
    buildLaunchCommand,
    buildLocal,
    buildSessionId,
    buildProjectDir,
    buildBrief,
    resetBuildFlow,
  } = useApp();

  const step = buildStep;
  const actions = buildLive?.actionCount ?? 0;
  const sessionId = buildLive?.sessionId ?? null;
  const target = buildPlan?.budgetActions ?? DEFAULT_BUDGET_ACTIONS;
  const unlocked = budgetState(Math.min(100, Math.round((actions / target) * 100))).unlock;

  const idx = step === 'during' ? 0 : 1;

  return (
    <section className="view on bc-view" id="v-build">
      <div className="vhead">
        <h1>Let&rsquo;s build</h1>
        <div className="sub">
          Byte watches your real Claude Code session, then helps you check &amp; remember what you built.
        </div>
      </div>

      <div className="bc-body">
        <div className="bc-rail">
          {RAIL.map((r, i) => (
            <div
              key={r.key}
              className={`bc-step${i === idx ? ' active' : ''}${i < idx ? ' done' : ''}`}
            >
              <div className="bc-rail-lbl">{r.label}</div>
              <div className="bc-rail-bar" />
            </div>
          ))}
        </div>

        {step === 'during' && (
          <DuringStep
            plan={buildPlan}
            live={buildLive}
            unlocked={unlocked}
            launchCommand={buildLaunchCommand}
            local={buildLocal}
            buildSessionId={buildSessionId}
            projectDir={buildProjectDir}
            brief={buildBrief}
          />
        )}
        {step === 'end' && (
          <EndStep
            companyId={companyId}
            sessionId={sessionId}
            plan={buildPlan}
            brief={buildBrief}
            actions={actions}
          />
        )}

        <div className="bc-nav">
          {step === 'end' && (
            <button className="bc-next" onClick={resetBuildFlow}>
              {NEXT_LABEL.end}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Prune now-unused imports**

Remove imports only used by the deleted `StartStep`/`startBuild` (e.g. `requestBuildPlan`, `armBuildSession`, `getCapability`, `buildOpeningPrompt`, `terminalCommand`, `ensureIngestToken`, `loadProjectDirs`, `subscribeLiveBuild`, `useCallback`, `useEffect`, `useState`, `BytePlan`, `LiveState` if no longer referenced). Keep `useApp`, `useAuth`, `Byte`, `budgetState`, `byteDuringLine`, `DANGER_PCT`, `LiveChat`, `writeNotebookNote`, `loadTrackEventForSession`, `DEFAULT_BUDGET_ACTIONS`, and anything `DuringStep`/`EndStep` still use.

- [ ] **Step 4: Typecheck (catches every dangling reference/import)**

Run: `npm run typecheck`
Expected: PASS. Iterate until there are no unused-import or undefined-name errors.

- [ ] **Step 5: Commit**

```bash
npx prettier --write components/views/BuildCoachView.tsx
npm run lint
git add components/views/BuildCoachView.tsx
git commit -m "refactor(build-coach): view renders DURING/END from the store (START moved to chat)"
```

---

## Task 5: Remove the sidebar tab + full verification

**Files:**
- Modify: `components/Sidebar.tsx` — remove the build nav entry (lines ~89–110).

**Interfaces:**
- Consumes: nothing new.
- Produces: the sidebar no longer lists "Let's build".

- [ ] **Step 1: Remove the nav entry**

In `components/Sidebar.tsx`, delete the object literal `{ view: 'build', label: "Let's build", icon: (...) }` from the nav items array (the whole block from line ~89 `{` to its closing `},` near line 110). Leave the surrounding entries intact.

- [ ] **Step 2: Typecheck + lint + unit tests**

```bash
npm run typecheck
npm run lint
npm test
```
Expected: all PASS. (`'build'` stays valid in the `View` union and `AppRoot` switch; it is now unreachable from the sidebar but reachable via `armBuild()`.)

- [ ] **Step 3: Manual end-to-end check**

Run: `npm run dev`, sign in, then:
1. Open the byte chat; with an empty thread, confirm the **"🔨 Let's build something"** button shows.
2. Tap it → Byte asks the opening question. Type an answer → Byte posts the follow-up + a **"Turn this into a plan →"** button. Type more (optional).
3. Tap **Turn this into a plan** → a plan card appears with **Start building**.
4. Tap **Start building** → the main area switches to the DURING view (LiveChat + piggy-bank meter) and Byte posts the "we're live" bubble in chat.
5. Confirm the sidebar no longer shows a "Let's build" tab.

Record what you observed (this is the evidence the feature works, per verification-before-completion).

- [ ] **Step 4: Commit**

```bash
npx prettier --write components/Sidebar.tsx
git add components/Sidebar.tsx
git commit -m "feat(build-coach): remove the Let's build sidebar tab (now started from chat)"
```

---

## Self-Review notes (author)

- **Spec coverage:** empty-state button (T3.4) ✔; scripted-natural intake (T2.6 `startBuildIntake`/`addIntakeTurn` + T1 copy) ✔; plan via `requestBuildPlan` (T2.6 `generateBuildPlan`) ✔; DURING/END in main reusing LiveChat/meter/habit/EndStep (T4) ✔; state in store slice + subscription in provider (T2) ✔; Byte proactive/closing nudges (T2.5 closing nudge; the mid-conversation proactive `action` button reuses the existing `action` mechanism and is out of scope for the core flow — noted as a follow-up, not a task) ✔; remove tab, `'build'` stays programmatic (T5) ✔; tests on the pure module (T1) ✔.
- **Deferred (matches spec "out of scope"):** AI-driven dynamic intake; live per-turn coaching bubble in chat (the main-area `CoachBubble` already shows Byte's coaching during DURING, so the chat only posts the "we're live" + closing nudges — a deliberate simplification consistent with the spec's intent).
- **Follow-up (not blocking):** Byte proactively offering a "Let's build" button mid-conversation (decision #4). The rendering hook exists (`buildAction`); wiring Byte to emit it when the chat is non-empty can be a small follow-up once the core flow lands.
- **Type consistency:** `buildAction.kind` values `'to-plan'` / `'start-building'` are used identically in T2 (produce) and T3 (render); `BuildStep` `'during' | 'end'` consistent across T1/T2/T4; `buildPlan: BytePlan` field name consistent T2↔T3↔T4.
