# Agent Run Theater — Live Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a running task visible and recoverable — `/api/run-task` streams the phases it genuinely executes (with the real brief fields and library titles it grounded on, real token usage, real elapsed time), and a full-width run theater renders them live.

**Architecture:** Three separable layers. (1) A pure, unit-tested module turns already-loaded server state into truthful `RunEvent` objects — no network, no Firestore, so its correctness is provable in vitest. (2) `/api/run-task` changes from `Response.json(...)` to an NDJSON stream that emits those events at the real boundaries it already crosses, then a terminal `result` event carrying today's exact `{ text }` / `{ payload }` shape. (3) The client reads the stream into a `LiveRun` state object; a `RunTheater` component renders it as the `run` view. The existing non-streaming path is kept as a fallback so an old client or a proxy that buffers the body still works.

**Tech Stack:** Next.js App Router (Node runtime), React 19 client components, TypeScript, Vitest (node environment), Firebase Auth/Firestore, Anthropic SDK.

## Global Constraints

- **Evidence must be true.** Every step line and every evidence quote is derived from state the server actually used in that run. If a value is absent, the step says so or is omitted — never a placeholder, never invented. No new copy may imitate `lib/helpers.ts:220` `buildLog` (fabricated diffs, "218 tests passed", "waitlist 1,504").
- **`buildLog` is not extended and not deleted in this plan.** It stays for the chat card's existing behavior; the theater must not call it.
- **Deliverable output shape is unchanged.** The terminal event's payload is byte-identical to today's `{ text?: string; payload?: unknown }` (`lib/ai/runTask.ts:48-51`), so `applyResult` needs no changes.
- **Credits stay honest.** Cost shown = `creditCostForRoute('runTask')` = `CREDIT_COSTS.heavy` = `4` (`lib/ai/credits.ts:18-40`). Do not invent per-step costs; a fraction shown mid-run must be labelled as the charge for the run, not a running meter of spend.
- **Auth and the daily cap are untouched.** The token check (`route.ts:74-85`) and `enforceDailyLimit` (`route.ts:123`) keep their current position and behavior, and both must still be able to return a non-200 JSON error before any streaming begins.
- **Fail-open grounding.** Missing brief fields / empty library must degrade to fewer steps, never an error (matches `route.ts:136` "fail-open — empty values just skip that grounding").
- **No motion without an escape.** Every animation added must be disabled under `prefers-reduced-motion: reduce`, and every state must stay distinguishable by glyph and text without color (spec success criterion 4).
- **Vitest is node-environment** (`vitest.config.ts`) — pure logic only in `*.test.ts`. Do not add jsdom or React rendering tests; there is no such harness in this repo.
- **`@/` alias works in vitest** (aliased in `vitest.config.ts`), but tests for pure modules should import by relative path to match neighbors like `lib/ai/priorWork.test.ts`.
- Run `npm run format:check` and `npm run lint` before any push (CI gates on both).

---

## File Structure

**Create:**

| Path | Responsibility |
|---|---|
| `lib/ai/runTrace.ts` | Pure. Turns loaded server state (brief, decisions, selected prior work, kind, dept, usage) into `RunEvent[]`. The single source of truth for what a step says and what evidence it carries. No I/O. |
| `lib/ai/runTrace.test.ts` | Unit tests for the above — the guarantee that no line is fabricated. |
| `lib/ai/runStream.ts` | Pure. NDJSON encode (`encodeEvent`) + incremental decode (`createEventDecoder`) shared by route and client, so framing bugs are tested once. |
| `lib/ai/runStream.test.ts` | Unit tests for framing: split chunks, partial lines, trailing newline, malformed line. |
| `lib/ai/liveRun.ts` | Pure. `LiveRun` state + `reduceRun(state, event)` — the state machine the theater renders. Tested without React. |
| `lib/ai/liveRun.test.ts` | Unit tests for the reducer across running / done / failed / rate-limited. |
| `components/run/RunTheater.tsx` | The theater view: header + status pill, preview canvas, step rail, action bar. Presentational — takes a `LiveRun`, emits callbacks. |
| `components/run/StepRail.tsx` | The rail: step rows, glyphs, expandable evidence, elapsed/credits footer. |
| `components/run/RunCanvas.tsx` | The preview canvas: outline of the deliverable's sections, filled on completion. |

**Modify:**

| Path | Change |
|---|---|
| `app/api/run-task/route.ts:174-198` | Replace the two `Response.json` returns with a streamed NDJSON body emitting the trace, then the terminal result. Auth/cap/grounding above line 174 unchanged. |
| `lib/ai/runTask.ts:58-68` | Add `runByteTaskStreaming(args, onEvent)` alongside `runByteTask`; keep `runByteTask` exactly as-is as the fallback. |
| `lib/store.tsx:202-212` | Add `'run'` to `View`. |
| `lib/store.tsx` (new state + action) | Add `liveRun` state, `startRunInTheater(deptK, taskTitle)`, `closeRunTheater()` to the context. |
| `components/AppRoot.tsx:43-57` | Render `RunTheater` when `view === 'run'`. |
| `app/globals.css` | Theater styles (`.rt-*`), tokens only — no new hex values outside the existing palette. |

---

### Task 1: Truthful trace events

**Files:**
- Create: `lib/ai/runTrace.ts`
- Test: `lib/ai/runTrace.test.ts`

**Interfaces:**
- Consumes: `PriorItem` from `lib/ai/priorWork.ts:11`; `CompanyBrief` from `lib/firebase/schema.ts:31`; `TokenUsage` from `lib/ai/client.ts:27`.
- Produces:
  - `type RunPhase = 'brief' | 'prior' | 'generate' | 'verify'`
  - `interface Evidence { quote: string; source: string }`
  - `interface RunStep { phase: RunPhase; label: string; source?: string; evidence: Evidence[] }`
  - `type RunEvent = { type: 'step'; step: RunStep } | { type: 'active'; phase: RunPhase } | { type: 'usage'; credits: number } | { type: 'result'; text?: string; payload?: unknown } | { type: 'error'; code: string }`
  - `function briefStep(brief: CompanyBrief | undefined): RunStep | null`
  - `function priorWorkStep(items: PriorItem[]): RunStep | null`
  - `function generateStep(kind: string, deptName: string | undefined): RunStep`

- [ ] **Step 1: Write the failing test**

Create `lib/ai/runTrace.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { briefStep, priorWorkStep, generateStep } from './runTrace';

describe('briefStep', () => {
  it('quotes only the brief fields that are actually present', () => {
    const step = briefStep({ oneLiner: 'A macOS companion that runs your company', audience: 'Solo technical founders' });
    expect(step).not.toBeNull();
    expect(step!.label).toBe('Read your Business Brief');
    expect(step!.source).toBe('Brief');
    expect(step!.evidence).toEqual([
      { quote: 'A macOS companion that runs your company', source: 'your one-liner' },
      { quote: 'Solo technical founders', source: 'who it’s for' },
    ]);
  });

  it('returns null when the brief has nothing groundable', () => {
    expect(briefStep({})).toBeNull();
    expect(briefStep(undefined)).toBeNull();
  });

  it('never invents evidence for a blank field', () => {
    const step = briefStep({ oneLiner: 'Ship faster', audience: '   ' });
    expect(step!.evidence).toEqual([{ quote: 'Ship faster', source: 'your one-liner' }]);
  });

  it('truncates a long field instead of dumping it', () => {
    const step = briefStep({ notes: 'x'.repeat(300) });
    expect(step!.evidence[0].quote.length).toBeLessThanOrEqual(160);
    expect(step!.evidence[0].quote.endsWith('…')).toBe(true);
  });
});

describe('priorWorkStep', () => {
  it('names the real deliverables that were selected', () => {
    const step = priorWorkStep([
      { title: 'Brand & voice', dept: 'Marketing', k: 'mkt', type: 'doc', out: 'warm, plain' },
      { title: 'Pricing model', dept: 'Finance', k: 'fin', type: 'sheet', out: '$8-15' },
    ]);
    expect(step!.label).toBe('Pulled 2 pieces of your approved work');
    expect(step!.source).toBe('Library');
    expect(step!.evidence).toEqual([
      { quote: 'Brand & voice', source: 'Marketing · doc' },
      { quote: 'Pricing model', source: 'Finance · sheet' },
    ]);
  });

  it('uses the singular when one item was selected', () => {
    const step = priorWorkStep([{ title: 'Brand & voice', dept: 'Marketing', k: 'mkt', type: 'doc', out: 'x' }]);
    expect(step!.label).toBe('Pulled 1 piece of your approved work');
  });

  it('returns null when nothing was selected, rather than claiming a lookup', () => {
    expect(priorWorkStep([])).toBeNull();
  });
});

describe('generateStep', () => {
  it('names the department that is writing', () => {
    expect(generateStep('doc', 'Marketing').label).toBe('Writing the Marketing deliverable');
  });

  it('falls back to a plain label with no department', () => {
    expect(generateStep('doc', undefined).label).toBe('Writing the deliverable');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ai/runTrace.test.ts`
Expected: FAIL — `Failed to resolve import "./runTrace"`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/ai/runTrace.ts`:

```ts
// The run's TRUTHFUL trace. Every line here is derived from state the server actually
// loaded and fed to the model on THIS run — this module exists so that claim is
// unit-testable. It is pure: no Firestore, no network, no clock.
//
// Deliberately NOT lib/helpers.ts:buildLog, which returns hardcoded strings per
// deliverable type ("218 tests passed", invented diffs). Nothing here may do that.
import type { PriorItem } from './priorWork';
import type { CompanyBrief } from '../firebase/schema';

export type RunPhase = 'brief' | 'prior' | 'generate' | 'verify';

/** One quoted fact and where it came from. The quote is verbatim founder/company content. */
export interface Evidence {
  quote: string;
  source: string;
}

export interface RunStep {
  phase: RunPhase;
  label: string;
  /** Where the step read from — shown as a chip. Omitted when the step reads nothing. */
  source?: string;
  evidence: Evidence[];
}

export type RunEvent =
  | { type: 'step'; step: RunStep }
  | { type: 'active'; phase: RunPhase }
  | { type: 'usage'; credits: number }
  | { type: 'result'; text?: string; payload?: unknown }
  | { type: 'error'; code: string };

const MAX_QUOTE = 160;

/** Collapse whitespace and cap length so a pasted README can't flood the rail. */
function quote(raw: string): string {
  const s = raw.trim().replace(/\s+/g, ' ');
  return s.length > MAX_QUOTE ? s.slice(0, MAX_QUOTE - 1) + '…' : s;
}

/** Brief fields worth showing, in the order they carry signal. Keep in sync with the
 *  fields composeProjectModel actually feeds the model (lib/ai/projectModel.ts). */
const BRIEF_FIELDS: ReadonlyArray<[keyof CompanyBrief, string]> = [
  ['oneLiner', 'your one-liner'],
  ['summary', 'byte’s read of the product'],
  ['audience', 'who it’s for'],
  ['goal', 'what you’re aiming at'],
  ['stage', 'your stage'],
  ['notes', 'your notes'],
];

export function briefStep(brief: CompanyBrief | undefined): RunStep | null {
  if (!brief) return null;
  const evidence: Evidence[] = [];
  for (const [key, source] of BRIEF_FIELDS) {
    const v = brief[key];
    if (typeof v === 'string' && v.trim()) evidence.push({ quote: quote(v), source });
  }
  if (!evidence.length) return null;
  return { phase: 'brief', label: 'Read your Business Brief', source: 'Brief', evidence };
}

export function priorWorkStep(items: PriorItem[]): RunStep | null {
  if (!items.length) return null;
  return {
    phase: 'prior',
    label: `Pulled ${items.length} piece${items.length === 1 ? '' : 's'} of your approved work`,
    source: 'Library',
    evidence: items.map((i) => ({ quote: i.title, source: `${i.dept} · ${i.type}` })),
  };
}

export function generateStep(kind: string, deptName: string | undefined): RunStep {
  return {
    phase: 'generate',
    label: deptName ? `Writing the ${deptName} deliverable` : 'Writing the deliverable',
    evidence: [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ai/runTrace.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/runTrace.ts lib/ai/runTrace.test.ts
git commit -m "feat(run): derive a truthful run trace from real grounding state"
```

---

### Task 2: NDJSON framing

**Files:**
- Create: `lib/ai/runStream.ts`
- Test: `lib/ai/runStream.test.ts`

**Interfaces:**
- Consumes: `RunEvent` from Task 1 (`lib/ai/runTrace.ts`).
- Produces:
  - `function encodeEvent(ev: RunEvent): string` — one JSON object plus `\n`.
  - `function createEventDecoder(): (chunk: string) => RunEvent[]` — stateful; buffers a partial trailing line across calls.

- [ ] **Step 1: Write the failing test**

Create `lib/ai/runStream.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { encodeEvent, createEventDecoder } from './runStream';
import type { RunEvent } from './runTrace';

const ev: RunEvent = { type: 'active', phase: 'generate' };

describe('encodeEvent', () => {
  it('writes one newline-terminated JSON object', () => {
    expect(encodeEvent(ev)).toBe('{"type":"active","phase":"generate"}\n');
  });
});

describe('createEventDecoder', () => {
  it('decodes whole lines', () => {
    const decode = createEventDecoder();
    expect(decode(encodeEvent(ev) + encodeEvent(ev))).toEqual([ev, ev]);
  });

  it('holds a partial line until its newline arrives', () => {
    const decode = createEventDecoder();
    const wire = encodeEvent(ev);
    const cut = wire.slice(0, 12);
    expect(decode(cut)).toEqual([]);
    expect(decode(wire.slice(12))).toEqual([ev]);
  });

  it('splits a chunk that carries one and a half events', () => {
    const decode = createEventDecoder();
    const wire = encodeEvent(ev);
    expect(decode(wire + wire.slice(0, 9))).toEqual([ev]);
    expect(decode(wire.slice(9))).toEqual([ev]);
  });

  it('skips a malformed line instead of throwing', () => {
    const decode = createEventDecoder();
    expect(decode('not json\n' + encodeEvent(ev))).toEqual([ev]);
  });

  it('ignores blank lines', () => {
    const decode = createEventDecoder();
    expect(decode('\n\n' + encodeEvent(ev))).toEqual([ev]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ai/runStream.test.ts`
Expected: FAIL — `Failed to resolve import "./runStream"`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/ai/runStream.ts`:

```ts
// NDJSON framing for the run stream. One event per line so the client can render a
// phase the moment its line lands, and so a truncated tail is never mis-parsed.
// Pure and shared by /api/run-task and the client reader — framing is tested once.
import type { RunEvent } from './runTrace';

export function encodeEvent(ev: RunEvent): string {
  return JSON.stringify(ev) + '\n';
}

/** Stateful decoder: feed it raw chunks, get back the events that completed. A partial
 *  trailing line is buffered until its newline arrives. Malformed lines are dropped —
 *  a single bad line must not kill a run the user is watching. */
export function createEventDecoder(): (chunk: string) => RunEvent[] {
  let buffer = '';
  return (chunk: string): RunEvent[] => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    const out: RunEvent[] = [];
    for (const line of lines) {
      const s = line.trim();
      if (!s) continue;
      try {
        out.push(JSON.parse(s) as RunEvent);
      } catch {
        // ignore — a malformed line is dropped, the run continues
      }
    }
    return out;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ai/runStream.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/runStream.ts lib/ai/runStream.test.ts
git commit -m "feat(run): NDJSON framing shared by the run route and client"
```

---

### Task 3: The live-run reducer

**Files:**
- Create: `lib/ai/liveRun.ts`
- Test: `lib/ai/liveRun.test.ts`

**Interfaces:**
- Consumes: `RunEvent`, `RunStep`, `RunPhase` from `lib/ai/runTrace.ts`.
- Produces:
  - `type RunStatus = 'running' | 'done' | 'failed' | 'limited'`
  - `interface LiveRun { deptK: string; taskTitle: string; deptName: string; type: string; status: RunStatus; steps: RunStep[]; activePhase: RunPhase | null; donePhases: RunPhase[]; credits: number | null; startedAt: number; endedAt: number | null; errorCode: string | null; result: { text?: string; payload?: unknown } | null }`
  - `function newRun(init: { deptK: string; taskTitle: string; deptName: string; type: string; startedAt: number }): LiveRun`
  - `function reduceRun(state: LiveRun, ev: RunEvent, now: number): LiveRun`
  - `function isFinished(state: LiveRun): boolean`

- [ ] **Step 1: Write the failing test**

Create `lib/ai/liveRun.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { newRun, reduceRun, isFinished } from './liveRun';
import type { RunStep } from './runTrace';

const base = () =>
  newRun({ deptK: 'mkt', taskTitle: 'Landing site', deptName: 'Marketing', type: 'doc', startedAt: 1000 });

const briefStep: RunStep = {
  phase: 'brief',
  label: 'Read your Business Brief',
  source: 'Brief',
  evidence: [{ quote: 'A macOS companion', source: 'your one-liner' }],
};

describe('newRun', () => {
  it('starts running with nothing done', () => {
    const r = base();
    expect(r.status).toBe('running');
    expect(r.steps).toEqual([]);
    expect(r.activePhase).toBeNull();
    expect(r.credits).toBeNull();
    expect(isFinished(r)).toBe(false);
  });
});

describe('reduceRun', () => {
  it('records a completed step and marks its phase done', () => {
    const r = reduceRun(base(), { type: 'step', step: briefStep }, 1200);
    expect(r.steps).toEqual([briefStep]);
    expect(r.donePhases).toEqual(['brief']);
  });

  it('tracks the active phase', () => {
    const r = reduceRun(base(), { type: 'active', phase: 'generate' }, 1200);
    expect(r.activePhase).toBe('generate');
  });

  it('clears the active phase once that phase completes', () => {
    let r = reduceRun(base(), { type: 'active', phase: 'brief' }, 1100);
    r = reduceRun(r, { type: 'step', step: briefStep }, 1200);
    expect(r.activePhase).toBeNull();
  });

  it('keeps a different active phase when another completes', () => {
    let r = reduceRun(base(), { type: 'active', phase: 'generate' }, 1100);
    r = reduceRun(r, { type: 'step', step: briefStep }, 1200);
    expect(r.activePhase).toBe('generate');
  });

  it('records the real credit charge', () => {
    const r = reduceRun(base(), { type: 'usage', credits: 4 }, 1300);
    expect(r.credits).toBe(4);
  });

  it('finishes on result, stamping the end time and clearing the spinner', () => {
    const r = reduceRun(base(), { type: 'result', text: 'the page' }, 5000);
    expect(r.status).toBe('done');
    expect(r.result).toEqual({ text: 'the page' });
    expect(r.endedAt).toBe(5000);
    expect(r.activePhase).toBeNull();
    expect(isFinished(r)).toBe(true);
  });

  it('keeps completed steps when the run fails', () => {
    let r = reduceRun(base(), { type: 'step', step: briefStep }, 1200);
    r = reduceRun(r, { type: 'active', phase: 'generate' }, 1300);
    r = reduceRun(r, { type: 'error', code: 'generation_failed' }, 4000);
    expect(r.status).toBe('failed');
    expect(r.errorCode).toBe('generation_failed');
    expect(r.steps).toEqual([briefStep]);
    expect(r.activePhase).toBeNull();
    expect(isFinished(r)).toBe(true);
  });

  it('distinguishes a usage limit from a generation failure', () => {
    const r = reduceRun(base(), { type: 'error', code: 'rate_limited' }, 4000);
    expect(r.status).toBe('limited');
  });

  it('ignores events after the run has finished', () => {
    const done = reduceRun(base(), { type: 'result', text: 'x' }, 5000);
    const after = reduceRun(done, { type: 'error', code: 'generation_failed' }, 6000);
    expect(after).toBe(done);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ai/liveRun.test.ts`
Expected: FAIL — `Failed to resolve import "./liveRun"`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/ai/liveRun.ts`:

```ts
// The state a founder is watching while a task runs. A pure reducer over the events
// /api/run-task streams, so the theater's behaviour (what stays on screen when a run
// fails, when the spinner clears) is unit-tested without React.
import type { RunEvent, RunPhase, RunStep } from './runTrace';

export type RunStatus = 'running' | 'done' | 'failed' | 'limited';

export interface LiveRun {
  deptK: string;
  taskTitle: string;
  deptName: string;
  /** Deliverable type (artType) — drives the canvas outline. */
  type: string;
  status: RunStatus;
  /** Steps that actually completed, in the order they completed. */
  steps: RunStep[];
  activePhase: RunPhase | null;
  donePhases: RunPhase[];
  /** Real credits charged for this run; null until the server reports it. */
  credits: number | null;
  startedAt: number;
  endedAt: number | null;
  errorCode: string | null;
  result: { text?: string; payload?: unknown } | null;
}

export function newRun(init: {
  deptK: string;
  taskTitle: string;
  deptName: string;
  type: string;
  startedAt: number;
}): LiveRun {
  return {
    ...init,
    status: 'running',
    steps: [],
    activePhase: null,
    donePhases: [],
    credits: null,
    endedAt: null,
    errorCode: null,
    result: null,
  };
}

export function isFinished(state: LiveRun): boolean {
  return state.status !== 'running';
}

export function reduceRun(state: LiveRun, ev: RunEvent, now: number): LiveRun {
  // A finished run is immutable — a late event must never reopen it or overwrite a result.
  if (isFinished(state)) return state;
  switch (ev.type) {
    case 'step':
      return {
        ...state,
        steps: [...state.steps, ev.step],
        donePhases: [...state.donePhases, ev.step.phase],
        // Only the phase that just completed stops being active.
        activePhase: state.activePhase === ev.step.phase ? null : state.activePhase,
      };
    case 'active':
      return { ...state, activePhase: ev.phase };
    case 'usage':
      return { ...state, credits: ev.credits };
    case 'result':
      return {
        ...state,
        status: 'done',
        result: { text: ev.text, payload: ev.payload },
        activePhase: null,
        endedAt: now,
      };
    case 'error':
      return {
        ...state,
        status: ev.code === 'rate_limited' || ev.code === 'http_429' ? 'limited' : 'failed',
        errorCode: ev.code,
        activePhase: null,
        endedAt: now,
      };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ai/liveRun.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/liveRun.ts lib/ai/liveRun.test.ts
git commit -m "feat(run): live-run reducer — failed runs keep the work they finished"
```

---

### Task 4: Stream the real phases from `/api/run-task`

**Files:**
- Modify: `app/api/run-task/route.ts:174-198`
- Modify: `app/api/run-task/route.ts:1-30` (imports + header comment)

**Interfaces:**
- Consumes: `briefStep`, `priorWorkStep`, `generateStep`, `RunEvent` (Task 1); `encodeEvent` (Task 2); existing `selectPriorWork` (`lib/ai/priorWork.ts:114`), `creditCostForRoute` (`lib/ai/credits.ts:45`).
- Produces: a `content-type: application/x-ndjson` response whose final event is `{ type: 'result', text? , payload? }`. Non-200 JSON errors (`unauthorized`, `bad_request`, `rate_limited`, `not_configured`) keep their exact current shape and status codes.

**Context the implementer needs:** the route currently computes everything the trace needs *before* generating — `company` (line 137), `library` (line 137), `priorWork` (line 151), `fields.deptName` (line 115), `kind` (line 103). `selectPriorWork` is called inline at line 152; hoist that call into a named `selected` const so the trace can report the items that were genuinely chosen.

- [ ] **Step 1: Hoist the selected prior work so it can be reported**

In `app/api/run-task/route.ts`, replace lines 151-159:

```ts
  const priorWork = composePriorWorkContext(
    selectPriorWork(library, {
      deptName: fields.deptName,
      excludeTitle: fields.taskTitle,
      query: [fields.taskTitle, fields.taskHint, fields.reviseNote].filter(Boolean).join(' '),
    }),
  );
```

with:

```ts
  // Hoisted so the run trace can report the prior work that was ACTUALLY selected —
  // the titles below are the same objects fed to the model, not a re-derivation.
  const selected = selectPriorWork(library, {
    deptName: fields.deptName,
    excludeTitle: fields.taskTitle,
    query: [fields.taskTitle, fields.taskHint, fields.reviseNote].filter(Boolean).join(' '),
  });
  const priorWork = composePriorWorkContext(selected);
```

- [ ] **Step 2: Add the imports**

At the end of the import block in `app/api/run-task/route.ts` (after line 28's `companionForDept` import), add:

```ts
import { briefStep, priorWorkStep, generateStep, type RunEvent } from '@/lib/ai/runTrace';
import { encodeEvent } from '@/lib/ai/runStream';
import { creditCostForRoute } from '@/lib/ai/credits';
```

- [ ] **Step 3: Replace the two JSON returns with a stream**

Replace lines 174-198 (the whole `try { … } catch { … }` block) with:

```ts
  // The response is an NDJSON stream: the founder sees each phase the moment the server
  // finishes it, and the last line carries the deliverable in the same shape the
  // non-streaming route returned. Errors after headers are sent become an `error` event
  // (the status line is already committed by then).
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: RunEvent) => controller.enqueue(encoder.encode(encodeEvent(ev)));
      try {
        // Grounding already happened above — report exactly what it used.
        const bStep = briefStep(company.brief ?? (body.brief as never));
        if (bStep) send({ type: 'step', step: bStep });
        const pStep = priorWorkStep(selected);
        if (pStep) send({ type: 'step', step: pStep });

        send({ type: 'active', phase: 'generate' });
        send({ type: 'usage', credits: creditCostForRoute('runTask') });

        if (schema) {
          const payload = await generateJson({
            client,
            system,
            prompt,
            maxTokens: 4096,
            label: `run-task:${kind}`,
            schema,
            onUsage,
          });
          send({ type: 'step', step: generateStep(kind, fields.deptName) });
          send({ type: 'result', payload });
        } else {
          const text = await generateText({
            client,
            system,
            prompt,
            maxTokens: 4096,
            label: `run-task:${kind}`,
            onUsage,
          });
          send({ type: 'step', step: generateStep(kind, fields.deptName) });
          send({ type: 'result', text });
        }
      } catch (err) {
        // Mirror aiErrorResponse's code so the client's existing GenerateError handling
        // (rate_limited / ai_unavailable) keeps working over the stream.
        const res = aiErrorResponse(err, 'generation_failed');
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        send({ type: 'error', code: data.error || 'generation_failed' });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      // Defeat proxy buffering so phases arrive as they happen rather than all at once.
      'x-accel-buffering': 'no',
    },
  });
```

Note the name collision: the request body is already bound to `body` at line 96-98. Rename the stream variable to `stream` and use `return new Response(stream, …)`, keeping the request `body` untouched. Make that rename now so the file typechecks.

- [ ] **Step 4: Verify the route typechecks**

Run: `npx tsc --noEmit`
Expected: no errors. If `company.brief ?? (body.brief as never)` complains, use the same precedence the route documents at lines 131-134:

```ts
        const briefForTrace = company.brief ?? (body.brief as CompanyBrief | undefined);
        const bStep = briefStep(briefForTrace);
```

and add `import type { CompanyBrief } from '@/lib/firebase/schema';`.

- [ ] **Step 5: Verify the existing suite still passes**

Run: `npm test`
Expected: PASS — the whole node suite, including `lib/ai/runTrace.test.ts`, `lib/ai/runStream.test.ts`, `lib/ai/liveRun.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add app/api/run-task/route.ts
git commit -m "feat(run): stream real grounding phases from /api/run-task"
```

---

### Task 5: Client stream reader

**Files:**
- Modify: `lib/ai/runTask.ts` (append after `runByteTask`, line 68)

**Interfaces:**
- Consumes: `RunEvent` (Task 1), `createEventDecoder` (Task 2), existing `RunArgs`/`RunResult`/`GenerateError` (`lib/ai/runTask.ts:32-56`).
- Produces: `function runByteTaskStreaming(args: RunArgs, onEvent: (ev: RunEvent) => void): Promise<RunResult>` — resolves with the same `RunResult` as `runByteTask`; throws `GenerateError` on a non-200 or on a streamed `error` event.

- [ ] **Step 1: Add the imports**

At the top of `lib/ai/runTask.ts`, after the existing imports (line 9), add:

```ts
import type { RunEvent } from './runTrace';
import { createEventDecoder } from './runStream';
```

- [ ] **Step 2: Append the streaming caller**

After `runByteTask` (line 68) in `lib/ai/runTask.ts`, add:

```ts
/** Run a task and observe the real phases as they land. Same request as runByteTask —
 *  the route answers with NDJSON. `onEvent` fires per event so the run theater can
 *  render a phase the moment the server finishes it; the promise resolves with the
 *  deliverable in the identical shape runByteTask returns, so applyResult is unchanged.
 *
 *  A response that is NOT NDJSON (an older deployment, or a proxy that rewrote it) is
 *  read as one JSON body instead — the theater then shows the finished run without
 *  intermediate phases rather than failing. */
export async function runByteTaskStreaming(
  args: RunArgs,
  onEvent: (ev: RunEvent) => void,
): Promise<RunResult> {
  const res = await fetch('/api/run-task', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new GenerateError(data.error || `http_${res.status}`);
  }
  const streamed = (res.headers.get('content-type') || '').includes('x-ndjson');
  if (!streamed || !res.body) {
    const result = (await res.json()) as RunResult;
    onEvent({ type: 'result', ...result });
    return result;
  }

  const reader = res.body.getReader();
  const utf8 = new TextDecoder();
  const decode = createEventDecoder();
  let result: RunResult | null = null;
  let failure: string | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const ev of decode(utf8.decode(value, { stream: true }))) {
      onEvent(ev);
      if (ev.type === 'result') result = { text: ev.text, payload: ev.payload };
      if (ev.type === 'error') failure = ev.code;
    }
  }
  if (failure) throw new GenerateError(failure);
  if (!result) throw new GenerateError('generation_failed');
  return result;
}
```

- [ ] **Step 3: Verify it typechecks and nothing regressed**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; suite PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/ai/runTask.ts
git commit -m "feat(run): client reader for the streamed run, with a non-streaming fallback"
```

---

### Task 6: Theater state in the store

**Files:**
- Modify: `lib/store.tsx:202-212` (View type)
- Modify: `lib/store.tsx` (context interface near line 331, provider body near line 1980, context value near line 3197 and 3322)

**Interfaces:**
- Consumes: `newRun`, `reduceRun`, `LiveRun` (Task 3); `runByteTaskStreaming` (Task 5); existing `artType`, `liveKind`, `applyResult`, `creditToolkitUse`, `bump`, `persistTaskDraft`, `setAiOffline`, `track`, `GenerateError`.
- Produces on the context:
  - `liveRun: LiveRun | null`
  - `startRunInTheater: (deptK: string, taskTitle: string) => void`
  - `closeRunTheater: () => void`
  - `retryRun: () => void`

- [ ] **Step 1: Add `'run'` to the View union**

In `lib/store.tsx:202-212`, add `| 'run'` after `| 'build'`:

```ts
export type View =
  | 'summary'
  | 'overview'
  | 'home'
  | 'dept'
  | 'tasks'
  | 'library'
  | 'env'
  | 'settings'
  | 'billing'
  | 'build'
  | 'run';
```

- [ ] **Step 2: Add the imports**

In `lib/store.tsx`, extend the existing `./ai/runTask` import (line 18) and add the reducer import:

```ts
import {
  runByteTask,
  runByteTaskStreaming,
  GenerateError,
  postEnrichAnswer,
  fetchTaskHelp,
} from './ai/runTask';
import { newRun, reduceRun, type LiveRun } from './ai/liveRun';
```

- [ ] **Step 3: Declare the context members**

In the context interface, immediately after `runTaskInChat: (deptK: string, taskTitle: string) => void;` (line 368), add:

```ts
  /** The run the founder is currently watching in the run theater, or null. */
  liveRun: LiveRun | null;
  /** Start a task in the full-width run theater (view 'run') and stream its phases. */
  startRunInTheater: (deptK: string, taskTitle: string) => void;
  /** Leave the theater. A finished run's deliverable is already applied; nothing is lost. */
  closeRunTheater: () => void;
  /** Re-run the task in the theater after a failure, from a clean trace. */
  retryRun: () => void;
```

- [ ] **Step 4: Implement the actions in the provider**

In the provider body, directly above `const runTaskInChat = useCallback(` (line 1980), add:

```ts
  const [liveRun, setLiveRun] = useState<LiveRun | null>(null);

  // Run a task in the theater. Same generation as runTaskInChat (runByteTaskStreaming →
  // applyResult), but the phases stream into a LiveRun the theater renders, and the
  // founder stays on a full-width surface instead of a 320px card.
  const startRunInTheater = useCallback(
    async (deptK: string, taskTitle: string) => {
      const d = DEPTS.find((x) => x.k === deptK);
      const t = d?.tasks.find((x) => x.t === taskTitle);
      if (!d || !t) return;
      const type = artType(t);
      const kind = liveKind(type);
      if (!kind) return; // not producible here — the chat path explains why
      setLiveRun(
        newRun({
          deptK,
          taskTitle: t.t,
          deptName: d.name,
          type,
          startedAt: Date.now(),
        }),
      );
      setView('run');
      track('run.theater_open', { dept: d.k, type });
      try {
        const res = await runByteTaskStreaming(
          { kind, taskTitle: t.t, taskHint: t.d, deptName: d.name, deptKey: d.k, brief, companionId },
          (ev) => setLiveRun((prev) => (prev ? reduceRun(prev, ev, Date.now()) : prev)),
        );
        applyResult(t, type, res);
        creditToolkitUse(t.t, type);
        bump();
        persistTaskDraft(d.k, t.t);
        setAiOffline(null);
      } catch (err) {
        const code = err instanceof GenerateError ? err.code : 'generation_failed';
        const limited = code === 'rate_limited' || code === 'http_429';
        if (limited || code === 'ai_unavailable') setAiOffline({ code, at: Date.now() });
        // The stream may already have delivered an `error` event; reduceRun ignores a
        // second one because a finished run is immutable.
        setLiveRun((prev) => (prev ? reduceRun(prev, { type: 'error', code }, Date.now()) : prev));
      }
    },
    [brief, bump, persistTaskDraft, creditToolkitUse, companionId],
  );

  const closeRunTheater = useCallback(() => {
    setLiveRun(null);
    setView('overview');
  }, []);

  const retryRun = useCallback(() => {
    if (liveRun) startRunInTheater(liveRun.deptK, liveRun.taskTitle);
  }, [liveRun, startRunInTheater]);
```

- [ ] **Step 5: Expose them on the context value**

Add `liveRun`, `startRunInTheater`, `closeRunTheater`, `retryRun` to the context value object (near line 3197) and to its dependency array (near line 3322), following the existing alphabetical-ish grouping used for `runBriefedTask` / `runTaskInChat`.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm test && npm run lint`
Expected: no type errors, suite PASS, lint clean. If lint reports the suppressions-count mismatch, regenerate per `docs`/`eslint-suppressions.json` convention — do NOT hand-edit the count.

- [ ] **Step 7: Commit**

```bash
git add lib/store.tsx
git commit -m "feat(run): live run state + theater actions in the store"
```

---

### Task 7: The step rail

**Files:**
- Create: `components/run/StepRail.tsx`
- Modify: `app/globals.css` (append a `/* run theater */` section)

**Interfaces:**
- Consumes: `LiveRun` (Task 3), `RunPhase`/`RunStep` (Task 1).
- Produces: `export function StepRail({ run, elapsed }: { run: LiveRun; elapsed: string }): JSX.Element`.

**Design constraints from the spec:** glyphs `✓ done · ◐ active · ○ pending · ✕ failed · ⏸ held`; a completed step expands to its evidence; footer shows elapsed and the run's real credit charge. Motion off under `prefers-reduced-motion`. Do not rely on color alone.

- [ ] **Step 1: Create the component**

Create `components/run/StepRail.tsx`:

```tsx
'use client';
import { useState } from 'react';
import type { LiveRun } from '@/lib/ai/liveRun';
import type { RunPhase } from '@/lib/ai/runTrace';

// Every phase the run can pass through, in order, with the label shown BEFORE the
// server has reported that phase. Once a real step arrives it replaces the label with
// the server's own words — pending rows are the only text not sourced from the run.
const PENDING: ReadonlyArray<[RunPhase, string]> = [
  ['brief', 'Read your Business Brief'],
  ['prior', 'Check your approved work'],
  ['generate', 'Write the deliverable'],
];

type Glyph = 'done' | 'active' | 'pending' | 'fail' | 'hold';

function Row({
  glyph,
  label,
  source,
  children,
  onToggle,
  open,
}: {
  glyph: Glyph;
  label: string;
  source?: string;
  children?: React.ReactNode;
  onToggle?: () => void;
  open?: boolean;
}) {
  return (
    <div className="rt-step" data-s={glyph} aria-expanded={children ? open : undefined}>
      <button className="rt-step-row" type="button" onClick={onToggle} disabled={!children}>
        <span className="rt-g" aria-hidden="true" />
        <span className="rt-step-t">{label}</span>
        {source ? <span className="rt-src">{source}</span> : <span />}
        {children ? <span className="rt-caret" aria-hidden="true" /> : <span />}
      </button>
      {children && open ? <div className="rt-ev">{children}</div> : null}
    </div>
  );
}

export function StepRail({ run, elapsed }: { run: LiveRun; elapsed: string }) {
  const [open, setOpen] = useState<RunPhase | null>(null);
  const done = new Map(run.steps.map((s) => [s.phase, s]));

  return (
    <aside className="rt-rail" aria-label="What the agent is doing">
      <div className="rt-rail-h">What {run.deptName} is doing</div>
      <div className="rt-steps">
        {PENDING.map(([phase, fallback]) => {
          const step = done.get(phase);
          const failedHere = run.status === 'failed' && run.activePhase === null && !step && phase === 'generate';
          const glyph: Glyph = step
            ? 'done'
            : run.activePhase === phase
              ? 'active'
              : failedHere
                ? 'fail'
                : run.status === 'limited' && phase === 'generate'
                  ? 'hold'
                  : 'pending';
          return (
            <Row
              key={phase}
              glyph={glyph}
              label={step ? step.label : fallback}
              source={step?.source}
              open={open === phase}
              onToggle={step?.evidence.length ? () => setOpen(open === phase ? null : phase) : undefined}
            >
              {step?.evidence.length
                ? step.evidence.map((e, i) => (
                    <div className="rt-ev-i" key={i}>
                      <q>{e.quote}</q>
                      <em>{e.source}</em>
                    </div>
                  ))
                : null}
            </Row>
          );
        })}
      </div>
      <div className="rt-rail-f">
        <span>{elapsed} elapsed</span>
        <span className="rt-dot">·</span>
        <span>{run.credits === null ? 'cost pending' : `${run.credits} credits for this run`}</span>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Add the styles**

Append to `app/globals.css`. Use existing tokens only (`--surface`, `--hairline`, `--t-1..--t-4`, `--accent`, `--accent-tint`, `--accent-line`, `--teal`, `--teal-tint`, `--teal-line`, `--rose*`, `--gold*`):

```css
/* ── run theater ─────────────────────────────────────────────────────────── */
.rt-rail {
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: 11px;
  display: flex;
  flex-direction: column;
}
.rt-rail-h {
  padding: 12px 14px 10px;
  border-bottom: 1px solid var(--hairline);
  font-size: 10.5px;
  font-weight: 620;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: var(--t-4);
}
.rt-steps {
  padding: 6px;
  display: flex;
  flex-direction: column;
}
.rt-step-row {
  font: inherit;
  text-align: left;
  width: 100%;
  background: none;
  border: 0;
  border-radius: 7px;
  padding: 8px;
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto auto;
  align-items: start;
  gap: 9px;
  color: var(--t-2);
}
.rt-step-row:enabled {
  cursor: pointer;
}
.rt-step-row:enabled:hover {
  background: var(--well);
}
.rt-step-t {
  font-size: 13px;
  line-height: 1.38;
  min-width: 0;
}
.rt-step[data-s='pending'] .rt-step-t {
  color: var(--t-4);
}
.rt-step[data-s='active'] .rt-step-t {
  color: var(--t-1);
  font-weight: 560;
}
.rt-src {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--t-4);
  border: 1px solid var(--hairline);
  border-radius: 4px;
  padding: 1px 5px;
  margin-top: 1px;
  white-space: nowrap;
}
.rt-caret {
  color: var(--t-4);
  font-size: 9px;
  margin-top: 4px;
}
.rt-caret::before {
  content: '\25B6';
}
.rt-step[aria-expanded='true'] .rt-caret {
  transform: rotate(90deg);
}
.rt-g {
  width: 15px;
  height: 15px;
  margin-top: 1px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 9.5px;
  font-weight: 700;
  line-height: 1;
}
.rt-step[data-s='done'] .rt-g {
  background: var(--teal-tint);
  border: 1px solid var(--teal-line);
  color: var(--teal);
}
.rt-step[data-s='done'] .rt-g::before {
  content: '\2713';
}
.rt-step[data-s='pending'] .rt-g {
  border: 1px solid var(--hairline);
}
.rt-step[data-s='fail'] .rt-g {
  background: var(--rose-tint);
  border: 1px solid var(--rose-line);
  color: var(--rose);
}
.rt-step[data-s='fail'] .rt-g::before {
  content: '\2715';
}
.rt-step[data-s='hold'] .rt-g {
  background: var(--gold-tint);
  border: 1px solid var(--gold-line);
  color: var(--gold);
  font-size: 8px;
  letter-spacing: -1px;
}
.rt-step[data-s='hold'] .rt-g::before {
  content: '\2759\2759';
}
.rt-step[data-s='active'] .rt-g {
  border: 1.5px solid var(--accent-line);
  border-top-color: var(--accent);
  animation: rt-spin 0.8s linear infinite;
}
@keyframes rt-spin {
  to {
    transform: rotate(360deg);
  }
}
.rt-ev {
  margin: 0 8px 8px 33px;
  background: var(--accent-tint);
  border: 1px solid var(--accent-line);
  border-radius: 3px;
  padding: 9px 11px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rt-ev-i {
  font-size: 12px;
  line-height: 1.45;
  color: var(--t-2);
}
.rt-ev-i em {
  display: block;
  font-style: normal;
  font-size: 10.5px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--accent-deep);
  margin-top: 2px;
  font-weight: 600;
}
.rt-rail-f {
  margin-top: auto;
  border-top: 1px solid var(--hairline);
  padding: 9px 14px;
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 11.5px;
  color: var(--t-3);
  font-variant-numeric: tabular-nums;
}
.rt-dot {
  color: var(--t-4);
}
@media (prefers-reduced-motion: reduce) {
  .rt-step[data-s='active'] .rt-g {
    animation: none;
    border-style: dashed;
  }
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run format:check`
Expected: no type errors; formatting clean (run `npm run format` if it complains).

- [ ] **Step 4: Commit**

```bash
git add components/run/StepRail.tsx app/globals.css
git commit -m "feat(run): step rail with expandable real evidence"
```

---

### Task 8: The preview canvas

**Files:**
- Create: `components/run/RunCanvas.tsx`
- Modify: `app/globals.css` (extend the run-theater section)

**Interfaces:**
- Consumes: `LiveRun` (Task 3).
- Produces: `export function RunCanvas({ run }: { run: LiveRun }): JSX.Element`.

**Behavior:** while running, show the outline of what the deliverable will contain with skeleton rows on the section the run is writing; on `done`, render the produced text. The outline labels come from the deliverable `type`, which is a real property of the task — not invented content.

- [ ] **Step 1: Create the component**

Create `components/run/RunCanvas.tsx`:

```tsx
'use client';
import type { LiveRun } from '@/lib/ai/liveRun';

// What each deliverable type is actually made of. These are the sections the schema in
// lib/ai/deliverableSchemas.ts produces — the outline is a true statement about the
// shape of the result, shown before the content exists.
const OUTLINE: Record<string, string[]> = {
  doc: ['Summary', 'Sections', 'Next steps'],
  site: ['Hero', 'How it works', 'Features', 'Call to action'],
  post: ['Hook', 'Body', 'Call to action'],
  email: ['Subject', 'Body', 'Sign-off'],
  checklist: ['Steps'],
  plan: ['Phases', 'Milestones'],
  sheet: ['Inputs', 'Projection'],
  screens: ['Screens', 'Flow'],
  legal: ['Clauses'],
  dms: ['Messages'],
  calendar: ['Schedule'],
  prep: ['Steps'],
};

export function RunCanvas({ run }: { run: LiveRun }) {
  const sections = OUTLINE[run.type] ?? ['Deliverable'];
  const text = run.result?.text?.trim();

  if (run.status === 'done') {
    return (
      <section className="rt-canvas" aria-label="Deliverable">
        {text ? (
          <div className="rt-out">{text}</div>
        ) : (
          <div className="rt-out rt-muted">
            Ready — open it to read the full deliverable.
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="rt-canvas" aria-label="Deliverable preview">
      {sections.map((s, i) => (
        <div className="rt-sec" key={s} data-s={run.activePhase === 'generate' && i === 0 ? 'active' : 'pending'}>
          <div className="rt-sec-h">{s}</div>
          {run.activePhase === 'generate' && i === 0 ? (
            <div className="rt-skel" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          ) : null}
        </div>
      ))}
      {run.status === 'failed' || run.status === 'limited' ? (
        <div className="rt-sec-note">
          {run.status === 'limited'
            ? 'Held before writing — nothing was charged for the part that did not run.'
            : 'Not written — the run stopped before this point.'}
        </div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 2: Add the styles**

Append to the run-theater section of `app/globals.css`:

```css
.rt-canvas {
  background: var(--canvas);
  border: 1px solid var(--hairline);
  border-radius: 11px;
  padding: 6px 20px 20px;
  min-width: 0;
}
.rt-sec {
  padding: 14px 0;
  border-bottom: 1px solid var(--hairline);
}
.rt-sec:last-child {
  border-bottom: 0;
}
.rt-sec-h {
  font-size: 10.5px;
  font-weight: 620;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: var(--t-4);
}
.rt-sec[data-s='pending'] .rt-sec-h {
  opacity: 0.72;
}
.rt-skel {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rt-skel i {
  display: block;
  height: 10px;
  border-radius: 3px;
  background: linear-gradient(90deg, var(--well) 0%, var(--surface-2) 50%, var(--well) 100%);
  background-size: 220% 100%;
  animation: rt-sweep 1.5s linear infinite;
}
.rt-skel i:nth-child(1) {
  width: 86%;
}
.rt-skel i:nth-child(2) {
  width: 74%;
}
.rt-skel i:nth-child(3) {
  width: 44%;
}
@keyframes rt-sweep {
  from {
    background-position: 120% 0;
  }
  to {
    background-position: -120% 0;
  }
}
.rt-out {
  white-space: pre-wrap;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--t-2);
  padding-top: 14px;
  max-width: 62ch;
}
.rt-muted {
  color: var(--t-4);
}
.rt-sec-note {
  font-size: 12px;
  color: var(--t-3);
  padding-top: 12px;
}
@media (prefers-reduced-motion: reduce) {
  .rt-skel i {
    animation: none;
  }
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run format:check`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add components/run/RunCanvas.tsx app/globals.css
git commit -m "feat(run): preview canvas — true outline while the run writes"
```

---

### Task 9: The theater, mounted

**Files:**
- Create: `components/run/RunTheater.tsx`
- Modify: `components/AppRoot.tsx:43-57`
- Modify: `app/globals.css` (extend the run-theater section)

**Interfaces:**
- Consumes: `useApp()` (`lib/store.tsx`) for `liveRun`, `closeRunTheater`, `retryRun`, `approveChatResult`, `openChatResult`; `StepRail` (Task 7); `RunCanvas` (Task 8).
- Produces: `export function RunTheater(): JSX.Element | null`.

- [ ] **Step 1: Create the component**

Create `components/run/RunTheater.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useApp } from '@/lib/store';
import { StepRail } from './StepRail';
import { RunCanvas } from './RunCanvas';

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const PILL: Record<string, { t: string; k: string }> = {
  running: { t: 'Running', k: 'active' },
  done: { t: 'Done', k: 'done' },
  failed: { t: 'Stopped', k: 'fail' },
  limited: { t: 'Paused', k: 'hold' },
};

export function RunTheater() {
  const { liveRun, closeRunTheater, retryRun, approveChatResult, openChatResult } = useApp();
  const [now, setNow] = useState(() => Date.now());

  // One ticking clock while the run is live; stops the moment it finishes.
  useEffect(() => {
    if (!liveRun || liveRun.status !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [liveRun?.status, liveRun]);

  if (!liveRun) return null;
  const run = liveRun;
  const pill = PILL[run.status] ?? PILL.running;
  const elapsed = mmss((run.endedAt ?? now) - run.startedAt);

  return (
    <main className="rt">
      <div className="rt-head">
        <button className="rt-back" type="button" onClick={closeRunTheater}>
          ← Back
        </button>
        <div className="rt-id">
          <h2>{run.taskTitle}</h2>
          <div className="rt-eyebrow">
            {run.deptName} · {run.type}
          </div>
        </div>
        <span className="rt-pill" data-k={pill.k}>
          {pill.t} {elapsed}
        </span>
      </div>

      {run.status === 'limited' ? (
        <div className="rt-banner">
          <b>Paused.</b> This workspace is out of AI credits. The finished steps are kept —
          topping up resumes from where it stopped.
        </div>
      ) : null}

      <div className="rt-body">
        <RunCanvas run={run} />
        <StepRail run={run} elapsed={elapsed} />
      </div>

      {run.status === 'done' ? (
        <div className="rt-acts">
          <button
            className="rt-b solid"
            type="button"
            onClick={() => {
              approveChatResult(run.deptK, run.taskTitle);
              closeRunTheater();
            }}
          >
            Approve
          </button>
          <button className="rt-b" type="button" onClick={() => openChatResult(run.deptK, run.taskTitle)}>
            Read
          </button>
        </div>
      ) : null}

      {run.status === 'failed' ? (
        <div className="rt-acts">
          <button className="rt-b solid" type="button" onClick={retryRun}>
            Try again
          </button>
          <button className="rt-b" type="button" onClick={closeRunTheater}>
            Leave it for now
          </button>
        </div>
      ) : null}
    </main>
  );
}
```

- [ ] **Step 2: Mount it in AppRoot**

In `components/AppRoot.tsx`, extend the view ternary chain (lines 43-57) with a `run` branch before the `settings` branch:

```tsx
    ) : view === 'run' ? (
      <RunTheater />
```

and add the import at the top of the file:

```tsx
import { RunTheater } from './run/RunTheater';
```

- [ ] **Step 3: Add the shell styles**

Append to the run-theater section of `app/globals.css`:

```css
.rt {
  padding: 18px 20px 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.rt-head {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}
.rt-back {
  font: inherit;
  font-size: 12.5px;
  color: var(--t-3);
  background: none;
  border: 0;
  padding: 3px 0;
  cursor: pointer;
  flex: none;
  margin-top: 3px;
}
.rt-back:hover {
  color: var(--t-1);
}
.rt-id {
  min-width: 0;
  flex: 1;
}
.rt-id h2 {
  margin: 0;
  font-size: 21px;
  font-weight: 620;
  letter-spacing: -0.02em;
}
.rt-eyebrow {
  font-size: 10.5px;
  font-weight: 620;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: var(--t-4);
  margin-top: 3px;
}
.rt-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  font-weight: 560;
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  color: var(--t-2);
  background: var(--surface);
  font-variant-numeric: tabular-nums;
  flex: none;
  margin-top: 2px;
}
.rt-pill[data-k='active'] {
  color: var(--accent-deep);
  background: var(--accent-tint);
  border-color: var(--accent-line);
}
.rt-pill[data-k='done'] {
  color: var(--teal);
  background: var(--teal-tint);
  border-color: var(--teal-line);
}
.rt-pill[data-k='fail'] {
  color: var(--rose);
  background: var(--rose-tint);
  border-color: var(--rose-line);
}
.rt-pill[data-k='hold'] {
  color: var(--gold-deep);
  background: var(--gold-tint);
  border-color: var(--gold-line);
}
.rt-banner {
  font-size: 12.5px;
  padding: 9px 13px;
  background: var(--gold-tint);
  border: 1px solid var(--gold-line);
  border-radius: 9px;
  color: var(--t-2);
}
.rt-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 292px;
  gap: 16px;
  align-items: start;
}
.rt-acts {
  display: flex;
  align-items: center;
  gap: 9px;
}
.rt-b {
  font: inherit;
  font-size: 13px;
  font-weight: 560;
  background: var(--surface);
  color: var(--t-1);
  border: 1px solid var(--hairline);
  border-radius: 9px;
  padding: 8px 17px;
  cursor: pointer;
}
.rt-b:hover {
  border-color: var(--accent-line);
  color: var(--accent-deep);
}
.rt-b.solid {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
@media (max-width: 900px) {
  .rt-body {
    grid-template-columns: minmax(0, 1fr);
  }
}
```

- [ ] **Step 4: Verify the whole thing builds**

Run: `npx tsc --noEmit && npm test && npm run lint && npm run format:check && npm run build`
Expected: all clean. `npm run build` must succeed — it is what Vercel runs.

- [ ] **Step 5: Commit**

```bash
git add components/run/RunTheater.tsx components/AppRoot.tsx app/globals.css
git commit -m "feat(run): mount the run theater as its own view"
```

---

### Task 10: A way in, and the preview deploy

**Files:**
- Modify: `components/views/TasksView.tsx` (add the entry point)

**Interfaces:**
- Consumes: `startRunInTheater` from `useApp()` (Task 6).
- Produces: nothing downstream — this is the last task.

**Why TasksView:** it is the smallest surface that lists runnable tasks (89 lines), so adding one control there does not disturb the Overview map or the chat flow. The chat path (`runTaskInChat`) is deliberately left alone so the two can be compared side by side on the preview.

- [ ] **Step 1: Read the file to find the task row**

Run: `sed -n '1,89p' components/views/TasksView.tsx`

Identify where each task row renders its existing action. Add a sibling control — do not replace the existing one, so the old path stays testable.

- [ ] **Step 2: Add the control**

Pull `startRunInTheater` from `useApp()` and render, on each task row that `liveKind(artType(t))` supports:

```tsx
<button className="rt-open" type="button" onClick={() => startRunInTheater(d.k, t.t)}>
  Run it here
</button>
```

Add to `app/globals.css`:

```css
.rt-open {
  font: inherit;
  font-size: 12px;
  font-weight: 560;
  color: var(--accent-deep);
  background: var(--accent-tint);
  border: 1px solid var(--accent-line);
  border-radius: 7px;
  padding: 4px 10px;
  cursor: pointer;
}
```

- [ ] **Step 3: Verify locally**

Run: `npx tsc --noEmit && npm test && npm run lint && npm run format:check && npm run build`
Expected: all clean.

- [ ] **Step 4: Commit and open the PR**

```bash
git add components/views/TasksView.tsx app/globals.css
git commit -m "feat(run): open a task in the run theater from Tasks"
git push -u origin feat/agent-run-theater
gh pr create --base develop --title "feat(run): agent run theater — real phases, real evidence" --body "$(cat <<'EOF'
## What

A task now runs on a full-width surface that shows the phases the server genuinely executed, with the real brief fields and library titles it grounded on, real elapsed time and the real credit charge.

## Why

Today's run transparency is fabricated: `lib/helpers.ts:220` (`buildLog`) returns hardcoded strings per deliverable type — "218 tests passed", diff counts derived from `t.t.length % 9`, "waitlist 1,504" — and `ExecLog.tsx:43` computes "Ran N actions" as `3 + (text.length % 6)`. None of it reflects the run. Meanwhile `/api/run-task` already computes exactly what would be truthful and throws it away.

## How

- `lib/ai/runTrace.ts` (pure, tested) turns real grounding state into events.
- `/api/run-task` streams NDJSON: real phases, then the same `{ text | payload }` it always returned.
- `lib/ai/liveRun.ts` (pure, tested) is the reducer — a failed run keeps the steps it finished.
- `components/run/*` renders it. `buildLog` is untouched; the chat path still uses it, so both can be compared on this preview.

## Testing

- `npm test` — new unit suites for the trace, the framing, and the reducer.
- On the preview: Tasks → "Run it here" on a runnable task.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Verify on the Vercel preview, not locally**

Per `docs`/team convention, first-run and streaming behavior must be checked on the PR's Vercel preview (StrictMode double-mount and HMR distort `next dev`). On the preview URL:

1. Sign in, go to Tasks, click **Run it here** on a runnable task.
2. Confirm the rail's phases appear *one at a time* (not all at once) — that proves the stream is not being buffered by the CDN.
3. Expand a completed step and confirm the quoted text matches your actual brief.
4. Confirm elapsed ticks and stops, and the credit line reads `4 credits for this run`.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Theater in the main column, chat stays | 9 (mounted as a view alongside the persistent Copilot) |
| Step rail with 6 glyph states | 7 (done/active/pending/fail/hold; `ask` is out of scope — see below) |
| Expandable evidence naming its source | 1 + 7 |
| Preview canvas: outline first, then content | 8 |
| Elapsed + credits, live | 7 + 9 |
| Running → Done → Approved | 6 + 9 |
| Failed mid-run keeps progress, retry resumes | 3 (`reduceRun` keeps `steps`) + 9 (`retryRun`) |
| Paused — out of credits | 3 (`limited`) + 9 (banner) |
| Motion off under reduced-motion | 7 + 8 |
| Distinguishable without color | 7 (glyph + text per state) |

**Known gaps, deliberately deferred and NOT silently dropped:**

1. **"Needs your input" mid-run** (spec state 4) has no task here. It requires the model to be able to *ask* mid-generation, which the current single-shot `generateJson` cannot do. It needs its own spec.
2. **Retry does not literally resume** — `retryRun` re-runs the task from a clean trace. The spec's "resumes from the step it died on" needs server-side partial-result persistence. The UI is honest about this: the button says "Try again", not "Resume".
3. **Section-by-section fill** is the outline + one reveal, per the scope decision. True per-section streaming was the option not taken.
4. **`buildLog`'s fabricated lines still ship** in the chat card. This plan does not remove them; that is a follow-up once the theater proves out.
