# Byte brainstorms at "Let's build" (adaptive Q&A + reflect-back)

**Date:** 2026-07-14
**Goal:** When a founder hits "Let's build", Byte should _brainstorm_ with them —
ask a few targeted, adaptive clarifying questions one at a time (who's it for /
core problem / scope / what "done" looks like), then reflect back a short "here's
what I'll build…" summary for the founder to confirm before Byte generates the
plan. Today the intake is two static lines ("Anything else?") with no real
back-and-forth. Must degrade gracefully to the current static flow if the AI call
fails or the key is missing.

Decided in brainstorming (Option 3): AI-driven adaptive questions **plus** a
reflect-back confirm step. Cap at ~3 questions so Byte never over-asks. Uses the
**company** `ANTHROPIC_API_KEY` (like `/api/build-plan`), not the user's Claude
subscription (that's only Let's-build's `claude` process).

## Current state (grounded)

- `lib/buildFlow.ts` holds the static copy: `INTAKE_OPENING` (Byte's opening
  question) and `INTAKE_FOLLOWUP` ("Anything else it must do? … hit 'Turn this
  into a plan'"), plus pure helpers `appendBrief` and `stepForLive`.
- `lib/store.tsx`:
  - `startBuildIntake` (line ~2339): sets `buildIntakeActive=true`, clears
    `buildBrief`, posts `INTAKE_OPENING` as a Byte message.
  - `addIntakeTurn(raw)` (line ~2368): appends the answer to `buildBrief`
    (`appendBrief`), posts the founder's message, then posts a Byte follow-up —
    `INTAKE_FOLLOWUP` on the first turn else "Got it — added. 👍" — carrying a
    transient `buildAction: { kind: 'to-plan', label: 'Turn this into a plan →' }`.
  - `generateBuildPlan` (line ~2395): posts a "Byte is turning this into a plan…"
    message, calls `requestBuildPlan({ brief, project })`, swaps in the plan card
    with a `start-building` action; on failure swaps in a retry (`to-plan`).
  - `ChatMessage.buildAction?: { kind: 'begin-intake' | 'to-plan' | 'start-building'; label }`
    (line ~123). `buildAction` is in-memory only (stripped on reload).
- `components/Copilot.tsx`:
  - `submit()` (line ~550): when `buildIntakeActive`, routes the draft to
    `addIntakeTurn(draft)`; otherwise normal chat.
  - Renders the `to-plan` button → `generateBuildPlan`, `begin-intake` →
    `startBuildIntake`, `start-building` → arms the build. Buttons show
    `m.buildAction.label` verbatim.
- `lib/ai/plan.ts` / `lib/ai/buildPlan.ts` / `app/api/build-plan/route.ts` are the
  **template** to mirror: a pure lib (input sanitize + prompt builder + strict
  JSON schema), a `'use client'` fetch helper that attaches the Firebase ID token,
  and a Node route that verifies the token, reads `ANTHROPIC_API_KEY`, calls
  `claude-opus-4-8` with `output_config.format = json_schema`, and returns the
  parsed object.

**Key insight:** the `to-plan` button and all of `Copilot.tsx` need **no change** —
the reflect-back "Build this →" step reuses the existing `to-plan` action (which
already calls `generateBuildPlan`), just with a different `label`. The whole
feature is: three new AI files + a pure decision helper + rework of
`startBuildIntake`/`addIntakeTurn` + one new store state field.

## Target design

### A. Pure brainstorm lib — `lib/ai/brainstorm.ts` (mirrors `lib/ai/plan.ts`)

Types:

```ts
export interface BrainstormTurn {
  role: 'byte' | 'user';
  text: string;
}
export interface BrainstormInput {
  conversation: BrainstormTurn[];
  project?: string;
}
export interface BrainstormReply {
  kind: 'question' | 'ready';
  text: string;
}
```

- `sanitizeBrainstormInput(body): BrainstormInput | null` — returns null unless
  `conversation` is a non-empty array containing at least one `user` turn; each
  turn's `role` must be `'byte'|'user'` and `text` a non-blank string trimmed and
  capped at `MAX_FIELD` (400, same as plan). Drops malformed turns; caps the
  conversation length (e.g. last 12 turns) so the prompt stays small. `project`
  trimmed/capped/optional like `PlanInput`.
- `buildBrainstormPrompt({ conversation, project }): string` — renders the Q&A as
  lines (`Byte: …` / `Founder: …`), states how many questions Byte has already
  asked (count of `byte` turns), and instructs: ask exactly ONE short, targeted
  question that fills the biggest remaining gap among {who it's for, core problem,
  scope/must-haves, what "done" looks like}; OR if you already have enough (or
  you've asked 3), return `kind:"ready"` with a 1-2 sentence reflect-back
  ("Here's what I'll build: …") in Byte's warm voice. Never ask something already
  answered. Token-thrifty.
- `BRAINSTORM_SCHEMA` — strict subset (`additionalProperties:false`, all required):
  ```
  { kind: {type:'string', enum:['question','ready']}, text: {type:'string'} }
  ```

### B. Client helper — `lib/ai/buildBrainstorm.ts` (mirrors `lib/ai/buildPlan.ts`)

```ts
export class BrainstormError extends Error { constructor(public code: string) … }
export async function requestBuildBrainstorm(input: BrainstormInput): Promise<BrainstormReply>
```

Same `authHeader()` (Firebase ID token) + `POST /api/build-brainstorm`; throws
`BrainstormError(code)` on non-OK; returns the parsed `{ kind, text }`.

### C. Route — `app/api/build-brainstorm/route.ts` (mirrors build-plan)

`runtime = 'nodejs'`. Verify the Firebase ID token (401 if missing/invalid),
require `ANTHROPIC_API_KEY` (503 if absent), `sanitizeBrainstormInput` the body
(400 if null). Call `claude-opus-4-8`, `max_tokens: 512`, `thinking:{type:'adaptive'}`,
`output_config: { effort:'low', format:{ type:'json_schema', schema: BRAINSTORM_SCHEMA } }`,
a `BYTE_BRAINSTORM_SYSTEM` prompt (warm brainstorming partner; ask ONE question at
a time; ≤3 questions; reflect back before building; reply only with the requested
JSON), `messages:[{role:'user', content: buildBrainstormPrompt(input)}]`. Parse the
text as `BrainstormReply`; return `{ reply }`. Same refusal/empty/parse error
handling as build-plan.

### D. Pure decision helper — `lib/buildFlow.ts`

Add a cap constant and a framework-free decision function so the branching is
unit-tested without React or network:

```ts
export const MAX_INTAKE_QUESTIONS = 3;

export type IntakeStep =
  | { mode: 'question'; text: string } // ask again, no button
  | { mode: 'ready'; text: string } // reflect-back + "Build this →" button
  | { mode: 'fallback'; text: string }; // static INTAKE_FOLLOWUP + button

/** Decide what Byte says after a founder's answer.
 *  reply === null means the AI call failed → fallback to the static flow.
 *  userTurns = how many answers the founder has now given (>=1). */
export function decideIntakeStep(reply: BrainstormReply | null, userTurns: number): IntakeStep;
```

Logic:

- `reply === null` → `{ mode:'fallback', text: INTAKE_FOLLOWUP }`.
- `reply.kind === 'ready'` → `{ mode:'ready', text: reply.text }`.
- `reply.kind === 'question'` **and** `userTurns >= MAX_INTAKE_QUESTIONS` → force
  wrap-up: `{ mode:'ready', text: READY_FALLBACK }` where `READY_FALLBACK` =
  "Alright — I've got enough to get started. Want me to turn this into a plan?"
  (Byte still returned a question, but we've hit the cap, so we stop asking.)
- else → `{ mode:'question', text: reply.text }`.

The `'ready'` and `'fallback'` modes both attach the `to-plan` button; only the
label differs ("Build this →" for ready, "Turn this into a plan →" for fallback).

### E. Store rework — `lib/store.tsx`

1. New state `buildIntakeLog: BrainstormTurn[]` (with the other build state), reset
   in `startBuildIntake` to `[{ role:'byte', text: INTAKE_OPENING }]`. (Kept in
   memory only — like `buildBrief`/`buildPlan`, it doesn't need to survive reload;
   an interrupted intake just falls back to typing more.)
2. `addIntakeTurn(raw)` becomes async-driven:
   - Trim; ignore blank. `const text = raw.trim()`.
   - `appendBrief` into `buildBrief`; push `{ role:'user', text }` into
     `buildIntakeLog` → compute `nextLog` synchronously for the API call.
   - Post the founder's message (persisted) + a transient Byte "thinking" message
     (`text: 'Byte is thinking…'`, no button), capturing its `thinkingId` — same
     pattern as `generateBuildPlan`.
   - `const userTurns = nextLog.filter(t => t.role === 'user').length`.
   - In an async IIFE: `let reply = null; try { reply = await requestBuildBrainstorm({ conversation: nextLog, project: buildProject || undefined }); } catch {}`
     then `const step = decideIntakeStep(reply, userTurns)` and map the thinking
     message:
     - `question` → set `text = step.text`, no `buildAction`; push
       `{ role:'byte', text: step.text }` into `buildIntakeLog`. (Founder answers
       again → `submit` → `addIntakeTurn`.)
     - `ready` / `fallback` → set `text = step.text` and
       `buildAction: { kind:'to-plan', label: step.mode === 'ready' ? 'Build this →' : 'Turn this into a plan →' }`.
   - The Byte thinking/answer message is transient (in-memory) exactly like the
     current follow-up — only the founder's answer is persisted.
3. `generateBuildPlan` unchanged — it already builds from the accumulated
   `buildBrief` and sets `buildIntakeActive=false` on success.
4. Wire `buildIntakeLog` reset anywhere the intake resets (`cancelBuildIntake`
   can leave it — it's re-initialized on the next `startBuildIntake`).

### F. UI — `components/Copilot.tsx`

**No changes.** `submit` already routes to `addIntakeTurn` while
`buildIntakeActive`; the `to-plan` button already calls `generateBuildPlan` and
renders `m.buildAction.label`. The new "Build this →" label flows through
unchanged.

## Data flow

`submit` → `addIntakeTurn(answer)` → append brief + log → POST
`/api/build-brainstorm` (company key) → `{ kind, text }` → `decideIntakeStep`:

- question → Byte asks the next question → founder answers → loop (≤3);
- ready → Byte reflects back "here's what I'll build…" + **Build this →** →
  founder clicks → `generateBuildPlan` (existing) → plan card → **Start building**.
  On any AI failure → static `INTAKE_FOLLOWUP` + **Turn this into a plan →** (today's
  exact behavior). Nothing can strand the founder.

## Error handling / graceful degradation

- AI error, missing key (503), refusal, parse failure, or network throw → the
  `catch` leaves `reply = null` → `decideIntakeStep` returns `fallback` → the
  founder gets the current static flow and can still build. **The feature never
  blocks a build.**
- Firebase not configured / signed-out → `authHeader()` sends no token → route
  401 → treated as failure → fallback. (Same posture as `requestBuildPlan`.)
- Hard cap `MAX_INTAKE_QUESTIONS = 3` guarantees termination even if the model
  keeps returning `question`.

## Out of scope

- Streaming Byte's question token-by-token (a single short reply; a "thinking…"
  placeholder is enough).
- Persisting the brainstorm transcript across reloads (in-memory, like the rest of
  the build state).
- Changing `generateBuildPlan` / the plan schema / the DURING/END flow.
- Editing the reflect-back summary inline (founder edits by typing another answer
  before clicking, or just proceeds).

## Success criteria

- Hitting "Let's build" → Byte asks a first question, then up to ~2 more adaptive
  ones based on the answers, then reflects back "here's what I'll build…" with a
  **Build this →** button that runs the existing plan generation.
- Byte never asks more than 3 questions; it also wraps up early when it already has
  enough.
- With `ANTHROPIC_API_KEY` unset (or any AI failure), the intake behaves exactly as
  it does today (static follow-up + "Turn this into a plan →").
- `npm run typecheck`, `npm run lint` (no new errors), `npm test` pass, with new
  unit tests for `sanitizeBrainstormInput`, `buildBrainstormPrompt`,
  `BRAINSTORM_SCHEMA` validity, and `decideIntakeStep` (all four branches incl. the
  cap).
