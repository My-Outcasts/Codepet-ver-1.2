# Byte brainstorms at "Let's build" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a founder hits "Let's build", Byte asks a few adaptive clarifying questions one at a time, then reflects back "here's what I'll build…" for confirmation before generating the plan — degrading gracefully to today's static flow on any AI failure.

**Architecture:** A new AI endpoint `/api/build-brainstorm` (mirrors `/api/build-plan`: company `ANTHROPIC_API_KEY`, Firebase-token auth, structured output) returns `{ kind: 'question' | 'ready', text }`. A pure `decideIntakeStep` helper turns that reply (or a null on failure) plus a question count into the next chat step. `addIntakeTurn` in the store drives the loop and reuses the existing `to-plan` button for the reflect-back confirm.

**Tech Stack:** Next.js (App Router, Node runtime route), React, TypeScript, `@anthropic-ai/sdk`, Firebase admin token verify, Vitest.

## Global Constraints

- App/UI copy is **English** (chat explanations to the user may be Vietnamese, but in-app strings are English).
- The brainstorm endpoint uses the **company** `ANTHROPIC_API_KEY` server-side (like `/api/build-plan`), never the user's Claude subscription.
- Model call mirrors build-plan: `claude-opus-4-8`, `thinking:{type:'adaptive'}`, `output_config.effort:'low'`, `output_config.format` = `{ type:'json_schema', schema: BRAINSTORM_SCHEMA }`. `max_tokens: 512`.
- Structured-output schemas are the strict subset: `additionalProperties:false` and **every** property in `required`.
- Hard cap `MAX_INTAKE_QUESTIONS = 3`; the flow must terminate even if the model keeps returning `question`.
- Any AI failure (missing key, 401/503/refusal/parse/network) falls back to the exact current static flow (`INTAKE_FOLLOWUP` + "Turn this into a plan →"). The feature must never block a build.
- `MAX_FIELD` cap for text fields is `400` (same as `lib/ai/plan.ts`).
- Byte messages/questions stay **in-memory only** (transient, like the current follow-up); only the founder's own answers are persisted via `persistMsg`.

---

### Task 1: Pure brainstorm lib (`lib/ai/brainstorm.ts`)

**Files:**
- Create: `lib/ai/brainstorm.ts`
- Test: `lib/ai/brainstorm.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `interface BrainstormTurn { role: 'byte' | 'user'; text: string }`
  - `interface BrainstormInput { conversation: BrainstormTurn[]; project?: string }`
  - `interface BrainstormReply { kind: 'question' | 'ready'; text: string }`
  - `sanitizeBrainstormInput(body: unknown): BrainstormInput | null`
  - `buildBrainstormPrompt(input: BrainstormInput): string`
  - `BRAINSTORM_SCHEMA: Record<string, unknown>`

- [ ] **Step 1: Write the failing test**

Create `lib/ai/brainstorm.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  sanitizeBrainstormInput,
  buildBrainstormPrompt,
  BRAINSTORM_SCHEMA,
} from './brainstorm';

describe('sanitizeBrainstormInput', () => {
  it('keeps valid byte/user turns and trims text', () => {
    const out = sanitizeBrainstormInput({
      conversation: [
        { role: 'byte', text: '  who is it for?  ' },
        { role: 'user', text: 'solo founders' },
      ],
    });
    expect(out).toEqual({
      conversation: [
        { role: 'byte', text: 'who is it for?' },
        { role: 'user', text: 'solo founders' },
      ],
    });
  });

  it('returns null without at least one user turn', () => {
    expect(sanitizeBrainstormInput({ conversation: [{ role: 'byte', text: 'hi' }] })).toBeNull();
    expect(sanitizeBrainstormInput({ conversation: [] })).toBeNull();
  });

  it('returns null for non-object / missing conversation', () => {
    expect(sanitizeBrainstormInput(null)).toBeNull();
    expect(sanitizeBrainstormInput({})).toBeNull();
    expect(sanitizeBrainstormInput({ conversation: 'nope' })).toBeNull();
  });

  it('drops malformed turns and caps text length', () => {
    const long = 'a'.repeat(500);
    const out = sanitizeBrainstormInput({
      conversation: [
        { role: 'alien', text: 'x' },
        { role: 'user', text: '' },
        { role: 'user', text: long },
      ],
    });
    expect(out?.conversation).toHaveLength(1);
    expect(out?.conversation[0].text.length).toBe(400);
  });

  it('keeps only the most recent 12 turns', () => {
    const conversation = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'byte' : 'user',
      text: `t${i}`,
    }));
    const out = sanitizeBrainstormInput({ conversation });
    expect(out?.conversation).toHaveLength(12);
    expect(out?.conversation[0].text).toBe('t8');
  });

  it('keeps a trimmed project and omits a blank one', () => {
    expect(
      sanitizeBrainstormInput({
        conversation: [{ role: 'user', text: 'x' }],
        project: '  Growth  ',
      })?.project,
    ).toBe('Growth');
    expect(
      sanitizeBrainstormInput({ conversation: [{ role: 'user', text: 'x' }], project: '  ' })
        ?.project,
    ).toBeUndefined();
  });
});

describe('buildBrainstormPrompt', () => {
  it('renders the transcript and the count of questions asked', () => {
    const p = buildBrainstormPrompt({
      conversation: [
        { role: 'byte', text: 'who is it for?' },
        { role: 'user', text: 'solo founders' },
        { role: 'byte', text: 'what problem?' },
        { role: 'user', text: 'tracking tokens' },
      ],
    });
    expect(p).toContain('Founder: solo founders');
    expect(p).toContain('Byte: who is it for?');
    expect(p).toContain('2 question');
  });

  it('includes the project when present and omits it otherwise', () => {
    const conversation = [{ role: 'user' as const, text: 'a' }];
    expect(buildBrainstormPrompt({ conversation, project: 'Growth' })).toContain('Growth');
    expect(buildBrainstormPrompt({ conversation })).not.toContain('Growth');
  });
});

describe('BRAINSTORM_SCHEMA', () => {
  it('is a strict object with kind enum and required text', () => {
    expect(BRAINSTORM_SCHEMA.additionalProperties).toBe(false);
    expect(BRAINSTORM_SCHEMA.required as string[]).toEqual(['kind', 'text']);
    const props = BRAINSTORM_SCHEMA.properties as Record<string, { type?: string; enum?: string[] }>;
    expect(props.kind?.enum).toEqual(['question', 'ready']);
    expect(props.text?.type).toBe('string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ai/brainstorm.test.ts`
Expected: FAIL — cannot resolve `./brainstorm`.

- [ ] **Step 3: Write the implementation**

Create `lib/ai/brainstorm.ts`:

```ts
// Pure, framework-free logic for Byte's brainstorm step at "Let's build". The
// server route (app/api/build-brainstorm) validates input with
// sanitizeBrainstormInput, prompts Claude with buildBrainstormPrompt, and
// constrains the reply to BRAINSTORM_SCHEMA. Kept here so validation + prompt
// shaping are unit-tested without a network call. Mirrors lib/ai/plan.ts. See
// docs/superpowers/specs/2026-07-14-byte-brainstorm-lets-build-design.md.

const MAX_FIELD = 400;
const MAX_TURNS = 12;

/** One line of the intake conversation Byte reasons over. */
export interface BrainstormTurn {
  role: 'byte' | 'user';
  text: string;
}

/** Request body for /api/build-brainstorm. */
export interface BrainstormInput {
  conversation: BrainstormTurn[];
  project?: string;
}

/** Byte's next move: ask one more question, or reflect back and offer to build. */
export interface BrainstormReply {
  kind: 'question' | 'ready';
  text: string;
}

/** Validate + normalize the request body. Returns null unless the conversation
 *  is an array with at least one non-blank founder ("user") turn. Malformed
 *  turns are dropped; text is trimmed/capped; only the most recent turns kept. */
export function sanitizeBrainstormInput(body: unknown): BrainstormInput | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.conversation)) return null;

  const conversation: BrainstormTurn[] = [];
  for (const raw of b.conversation) {
    if (!raw || typeof raw !== 'object') continue;
    const t = raw as Record<string, unknown>;
    const role = t.role === 'byte' || t.role === 'user' ? t.role : null;
    const text = typeof t.text === 'string' ? t.text.trim().slice(0, MAX_FIELD) : '';
    if (!role || !text) continue;
    conversation.push({ role, text });
  }

  const trimmed = conversation.slice(-MAX_TURNS);
  if (!trimmed.some((t) => t.role === 'user')) return null;

  const project = typeof b.project === 'string' ? b.project.trim().slice(0, MAX_FIELD) : '';
  return project ? { conversation: trimmed, project } : { conversation: trimmed };
}

/** Compose the user prompt: the transcript + how many questions Byte has asked
 *  + the ask-one-or-reflect-back instruction. */
export function buildBrainstormPrompt({ conversation, project }: BrainstormInput): string {
  const asked = conversation.filter((t) => t.role === 'byte').length;
  const transcript = conversation
    .map((t) => `${t.role === 'byte' ? 'Byte' : 'Founder'}: ${t.text}`)
    .join('\n');
  return [
    'You are brainstorming a build with a vibe-coder before writing a plan.',
    'Understand what they want by asking short, targeted questions — one at a',
    'time — then reflect it back for them to confirm.',
    '',
    project ? `Project area: ${project}` : null,
    'Conversation so far:',
    transcript,
    '',
    `You have already asked ${asked} question(s).`,
    'Decide ONE of:',
    '- kind:"question" — ask exactly ONE short question that fills the biggest',
    "  remaining gap among: who it's for, the core problem, scope/must-haves, and",
    '  what "done" looks like. Never re-ask something already answered.',
    '- kind:"ready" — if you already have enough, OR you have asked 3 questions,',
    '  reflect back what you will build in 1-2 warm sentences ("Here\'s what I\'ll',
    '  build: ..."). Do not ask another question.',
    '',
    'Keep it token-thrifty. Reply only with the requested JSON.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

// Strict JSON-schema subset: additionalProperties:false + every property required.
export const BRAINSTORM_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: {
      type: 'string',
      enum: ['question', 'ready'],
      description: 'question = ask one more; ready = reflect back and offer to build.',
    },
    text: {
      type: 'string',
      description: 'The single next question, or the 1-2 sentence reflect-back summary.',
    },
  },
  required: ['kind', 'text'],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ai/brainstorm.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/brainstorm.ts lib/ai/brainstorm.test.ts
git commit -m "feat(build): pure brainstorm lib — sanitize, prompt, schema"
```

---

### Task 2: Intake decision helper (`lib/buildFlow.ts`)

**Files:**
- Modify: `lib/buildFlow.ts`
- Test: `lib/buildFlow.test.ts` (extend)

**Interfaces:**
- Consumes: `BrainstormReply` (type-only) from `./ai/brainstorm`; existing `INTAKE_FOLLOWUP`.
- Produces:
  - `const MAX_INTAKE_QUESTIONS = 3`
  - `const READY_FALLBACK: string`
  - `type IntakeStep = { mode: 'question' | 'ready' | 'fallback'; text: string }`
  - `decideIntakeStep(reply: BrainstormReply | null, userTurns: number): IntakeStep`

- [ ] **Step 1: Write the failing test**

Append to `lib/buildFlow.test.ts` (add the imports to the existing import line and add the new `describe` block):

```ts
import {
  appendBrief,
  stepForLive,
  INTAKE_OPENING,
  INTAKE_FOLLOWUP,
  decideIntakeStep,
  READY_FALLBACK,
  MAX_INTAKE_QUESTIONS,
} from './buildFlow';

describe('decideIntakeStep', () => {
  it('falls back to the static follow-up when the AI call failed (null)', () => {
    expect(decideIntakeStep(null, 1)).toEqual({ mode: 'fallback', text: INTAKE_FOLLOWUP });
  });

  it('passes a ready reflect-back through with its text', () => {
    expect(decideIntakeStep({ kind: 'ready', text: "Here's what I'll build: X" }, 1)).toEqual({
      mode: 'ready',
      text: "Here's what I'll build: X",
    });
  });

  it('asks the next question below the cap', () => {
    expect(decideIntakeStep({ kind: 'question', text: 'who is it for?' }, 1)).toEqual({
      mode: 'question',
      text: 'who is it for?',
    });
  });

  it('forces ready when a question arrives at the cap', () => {
    expect(
      decideIntakeStep({ kind: 'question', text: 'one more?' }, MAX_INTAKE_QUESTIONS),
    ).toEqual({ mode: 'ready', text: READY_FALLBACK });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/buildFlow.test.ts`
Expected: FAIL — `decideIntakeStep`/`READY_FALLBACK`/`MAX_INTAKE_QUESTIONS` not exported.

- [ ] **Step 3: Write the implementation**

In `lib/buildFlow.ts`, add the type import at the top (after the existing `import type { LiveState } from './liveBuild';` line):

```ts
import type { BrainstormReply } from './ai/brainstorm';
```

Then append at the end of the file:

```ts
/** Most questions Byte asks before it must reflect back and offer to build. */
export const MAX_INTAKE_QUESTIONS = 3;

/** Byte's wrap-up line when the founder hits the question cap. */
export const READY_FALLBACK = `Alright — I've got enough to get started. Want me to turn this into a plan? 😎`;

/** What Byte does after a founder's intake answer. `question` re-prompts with no
 *  button; `ready` and `fallback` both attach the "to-plan" button (different label). */
export type IntakeStep =
  | { mode: 'question'; text: string }
  | { mode: 'ready'; text: string }
  | { mode: 'fallback'; text: string };

/** Decide Byte's next intake step. `reply === null` means the AI call failed →
 *  fall back to the static flow. `userTurns` is how many answers the founder has
 *  now given (>= 1); at the cap a lingering question is forced to wrap up. */
export function decideIntakeStep(reply: BrainstormReply | null, userTurns: number): IntakeStep {
  if (reply === null) return { mode: 'fallback', text: INTAKE_FOLLOWUP };
  if (reply.kind === 'ready') return { mode: 'ready', text: reply.text };
  if (userTurns >= MAX_INTAKE_QUESTIONS) return { mode: 'ready', text: READY_FALLBACK };
  return { mode: 'question', text: reply.text };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/buildFlow.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/buildFlow.ts lib/buildFlow.test.ts
git commit -m "feat(build): decideIntakeStep helper + question cap"
```

---

### Task 3: Network layer — client helper + route

**Files:**
- Create: `lib/ai/buildBrainstorm.ts`
- Create: `app/api/build-brainstorm/route.ts`

**Interfaces:**
- Consumes: `BrainstormInput`, `BrainstormReply`, `sanitizeBrainstormInput`, `buildBrainstormPrompt`, `BRAINSTORM_SCHEMA` from `lib/ai/brainstorm` (Task 1); `getFirebaseAuth`/`isFirebaseConfigured` from `lib/firebase/client`; `verifyIdToken` from `@/lib/firebase/admin`.
- Produces: `requestBuildBrainstorm(input: BrainstormInput): Promise<BrainstormReply>` and `class BrainstormError extends Error { code: string }`; the `POST /api/build-brainstorm` route returning `{ reply: BrainstormReply }`.

> No unit test — this layer mirrors `lib/ai/buildPlan.ts` + `app/api/build-plan/route.ts`, which have no unit tests (the pure logic they call is covered by Task 1). Verification is `typecheck` + `lint`.

- [ ] **Step 1: Write the client helper**

Create `lib/ai/buildBrainstorm.ts`:

```ts
'use client';
// Client helper for Byte's brainstorm step at "Let's build". Calls the server
// route (which holds the Anthropic key) with the running conversation and returns
// Byte's next move — another question, or a reflect-back "ready". Attaches the
// signed-in user's Firebase ID token. Mirrors lib/ai/buildPlan.ts.
import { getFirebaseAuth, isFirebaseConfigured } from '../firebase/client';
import type { BrainstormInput, BrainstormReply } from './brainstorm';

async function authHeader(): Promise<Record<string, string>> {
  if (!isFirebaseConfigured) return {};
  const user = getFirebaseAuth().currentUser;
  if (!user) return {};
  return { authorization: `Bearer ${await user.getIdToken()}` };
}

export class BrainstormError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = 'BrainstormError';
  }
}

export async function requestBuildBrainstorm(input: BrainstormInput): Promise<BrainstormReply> {
  const res = await fetch('/api/build-brainstorm', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new BrainstormError(data.error || `http_${res.status}`);
  }
  const { reply } = (await res.json()) as { reply: BrainstormReply };
  return reply;
}
```

- [ ] **Step 2: Write the route**

Create `app/api/build-brainstorm/route.ts`:

```ts
// Byte's brainstorm step — the adaptive Q&A before a plan. Takes the running
// intake conversation and returns Byte's next move (another question, or a
// reflect-back "ready" summary). Mirrors app/api/build-plan: ANTHROPIC_API_KEY
// stays server-side, the caller must present a valid Firebase ID token, and the
// reply is constrained to BRAINSTORM_SCHEMA via structured outputs. Node runtime.
// See docs/superpowers/specs/2026-07-14-byte-brainstorm-lets-build-design.md.
import Anthropic from '@anthropic-ai/sdk';
import { verifyIdToken } from '@/lib/firebase/admin';
import {
  sanitizeBrainstormInput,
  buildBrainstormPrompt,
  BRAINSTORM_SCHEMA,
  type BrainstormReply,
} from '@/lib/ai/brainstorm';

export const runtime = 'nodejs';

const BYTE_BRAINSTORM_SYSTEM = `You are Byte, the warm, encouraging building companion inside Codepet. Before building a feature, you brainstorm with a "vibe-coder" to understand what they want.

Ask ONE short, targeted question at a time (who it's for, the core problem, scope, what "done" looks like). Ask at most 3 questions total, then reflect back what you'll build for them to confirm. Voice: warm, plain-language, concrete, lightly playful. Reply only with the requested JSON — no preamble.`;

export async function POST(req: Request): Promise<Response> {
  // Paid API — require a valid Firebase ID token, same as /api/build-plan.
  const authz = req.headers.get('authorization') ?? '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  if (!idToken) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    await verifyIdToken(idToken);
  } catch {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'not_configured', message: 'ANTHROPIC_API_KEY is not set on the server.' },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const input = sanitizeBrainstormInput(body);
  if (!input) {
    return Response.json(
      { error: 'bad_request', message: 'conversation is required.' },
      { status: 400 },
    );
  }

  const client = new Anthropic({ apiKey });
  try {
    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 512,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema: BRAINSTORM_SCHEMA } },
      system: BYTE_BRAINSTORM_SYSTEM,
      messages: [{ role: 'user', content: buildBrainstormPrompt(input) }],
    });

    if (message.stop_reason === 'refusal') {
      return Response.json({ error: 'refused' }, { status: 422 });
    }

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    if (!text) {
      return Response.json({ error: 'empty' }, { status: 502 });
    }

    try {
      const reply = JSON.parse(text) as BrainstormReply;
      return Response.json({ reply });
    } catch {
      console.error('[build-brainstorm] structured output was not valid JSON');
      return Response.json({ error: 'parse_failed' }, { status: 502 });
    }
  } catch (err) {
    console.error('[build-brainstorm] generation failed', err);
    const status = err instanceof Anthropic.APIError ? (err.status ?? 502) : 502;
    return Response.json({ error: 'generation_failed' }, { status });
  }
}
```

- [ ] **Step 3: Verify types + lint**

Run: `npm run typecheck && npx eslint lib/ai/buildBrainstorm.ts app/api/build-brainstorm/route.ts`
Expected: no errors. (If `verifyIdToken` import path or the `output_config` shape differs, cross-check against `app/api/build-plan/route.ts` and match it exactly.)

- [ ] **Step 4: Commit**

```bash
git add lib/ai/buildBrainstorm.ts app/api/build-brainstorm/route.ts
git commit -m "feat(build): /api/build-brainstorm route + client helper"
```

---

### Task 4: Wire the loop into the store (`lib/store.tsx`)

**Files:**
- Modify: `lib/store.tsx`

**Interfaces:**
- Consumes: `requestBuildBrainstorm` (Task 3), `decideIntakeStep`/`BrainstormTurn`/`INTAKE_OPENING` (Tasks 1-2), existing `appendBrief`, `persistMsg`, `stripBuildButtons`, `newId`, `buildProject`, `setBuildIntakeActive`, `setBuildPlanState`.
- Produces: reworked `startBuildIntake` + async-driven `addIntakeTurn`; new in-memory state `buildIntakeLog`. `generateBuildPlan` and `Copilot.tsx` are unchanged.

> No unit test — the store has no test harness; the branching logic under test lives in `decideIntakeStep` (Task 2). Verification is `typecheck` + `lint` + the full suite staying green.

- [ ] **Step 1: Add imports**

In the `./buildFlow` import block (currently lines ~76-82), add `decideIntakeStep`:

```ts
import {
  appendBrief,
  stepForLive,
  INTAKE_OPENING,
  INTAKE_FOLLOWUP,
  decideIntakeStep,
  type BuildStep,
} from './buildFlow';
```

After the `import { requestBuildPlan } from './ai/buildPlan';` line, add:

```ts
import { requestBuildBrainstorm } from './ai/buildBrainstorm';
import type { BrainstormTurn } from './ai/brainstorm';
```

- [ ] **Step 2: Add the intake-log state**

Immediately after the `const [buildIntakeActive, setBuildIntakeActive] = useState(false);` line (~556), add:

```ts
  // The running brainstorm transcript (Byte questions + founder answers) that
  // /api/build-brainstorm reasons over. In-memory only, like buildBrief — an
  // interrupted intake just falls back to typing more.
  const [buildIntakeLog, setBuildIntakeLog] = useState<BrainstormTurn[]>([]);
```

- [ ] **Step 3: Seed the log in `startBuildIntake`**

In `startBuildIntake` (~2339), after `setBuildBrief('');` add:

```ts
    setBuildIntakeLog([{ role: 'byte', text: INTAKE_OPENING }]);
```

- [ ] **Step 4: Rework `addIntakeTurn` to drive the AI loop**

Replace the entire `addIntakeTurn` callback (~2368-2393) with:

```ts
  const addIntakeTurn = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      setBuildBrief((b) => appendBrief(b, text));

      const nextLog: BrainstormTurn[] = [...buildIntakeLog, { role: 'user', text }];
      setBuildIntakeLog(nextLog);
      const userTurns = nextLog.filter((t) => t.role === 'user').length;

      const now = Date.now();
      const userMsg: ChatMessage = { id: newId(), role: 'me', text, ts: now };
      const thinkingId = newId();
      setChatMessages((prev) => [
        ...stripBuildButtons(prev),
        userMsg,
        // Transient "thinking" bubble, swapped for Byte's question/summary below.
        { id: thinkingId, role: 'byte', text: 'Byte is thinking…', ts: now + 1 },
      ]);
      // Persist only the founder's real answer; Byte's turns are transient like
      // the result cards (they carry in-memory-only buttons and reload dead).
      persistMsg({ id: userMsg.id, role: 'me', text, ts: userMsg.ts });

      (async () => {
        let reply = null as Awaited<ReturnType<typeof requestBuildBrainstorm>> | null;
        try {
          reply = await requestBuildBrainstorm({
            conversation: nextLog,
            project: buildProject || undefined,
          });
        } catch {
          reply = null; // Any failure → static fallback via decideIntakeStep.
        }
        const step = decideIntakeStep(reply, userTurns);
        if (step.mode === 'question') {
          setBuildIntakeLog((prev) => [...prev, { role: 'byte', text: step.text }]);
        }
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === thinkingId
              ? {
                  ...m,
                  text: step.text,
                  ...(step.mode === 'question'
                    ? {}
                    : {
                        buildAction: {
                          kind: 'to-plan' as const,
                          label: step.mode === 'ready' ? 'Build this →' : 'Turn this into a plan →',
                        },
                      }),
                }
              : m,
          ),
        );
      })();
    },
    [buildIntakeLog, buildProject, persistMsg],
  );
```

- [ ] **Step 5: Verify types, lint, and the full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: typecheck clean, no new lint errors, all tests pass (`665+` green, including the new brainstorm + buildFlow cases).

- [ ] **Step 6: Manual smoke (document, don't automate)**

With `ANTHROPIC_API_KEY` set and signed in: hit "Let's build", answer once → Byte asks a targeted follow-up (no button); after ~2-3 answers Byte reflects back "Here's what I'll build…" with a **Build this →** button → clicking runs `generateBuildPlan` → plan card → **Start building**. With the key unset (or offline): the first answer yields the static "Anything else…" follow-up + **Turn this into a plan →**. Confirm neither path strands the founder.

- [ ] **Step 7: Commit**

```bash
git add lib/store.tsx
git commit -m "feat(build): Byte brainstorms at Let's build — adaptive Q&A + reflect-back"
```

---

## Self-Review

- **Spec coverage:** A → Task 1 (`brainstorm.ts`). B → Task 3 (`buildBrainstorm.ts`). C → Task 3 (route). D → Task 2 (`decideIntakeStep` + cap). E → Task 4 (store rework, `buildIntakeLog`). F → Task 4 note (Copilot unchanged). Graceful degradation → Task 2 `null`→fallback + Task 4 `catch`→`reply=null`. Cap → Task 2. All success criteria map to Tasks 1-4 steps.
- **Placeholders:** none — every code step carries full code; commands have expected output.
- **Type consistency:** `BrainstormTurn`/`BrainstormInput`/`BrainstormReply` defined in Task 1 and imported unchanged in Tasks 2-4. `decideIntakeStep(reply, userTurns)` signature identical across Task 2 definition and Task 4 call. `buildAction.kind: 'to-plan'` matches the existing `ChatMessage.buildAction` union and the existing `Copilot.tsx` handler → `generateBuildPlan`. `output_config`/`thinking` shapes copied verbatim from `app/api/build-plan/route.ts`.
