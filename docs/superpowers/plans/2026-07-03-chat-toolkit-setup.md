# byte drives the toolkit from chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let byte suggest an off toolkit item (skill/connector/agent) in chat and, on the founder's one-tap approval, turn it on — closing the loop between the chat brain and the Environment view.

**Architecture:** A third chat tool `setup_capability` rides the existing `run_task`/`navigate` rails. The client sends the founder's currently-off toolkit items to `/api/chat` (like it already sends `openTasks`); the server grounds byte in that list and, if byte suggests one, validates it and emits a `setup` action on the stream. The client renders a `SetupCard`; approving calls a new `setupCapability` store action that sets the item on (idempotent) and persists to Firestore — the same `s` flag the Environment buttons flip.

**Tech Stack:** Next.js (App Router), TypeScript, React, Anthropic SDK (server), Vitest, Firestore.

## Global Constraints

- "Connect" = **in-app state flip** (`item.s = 1` + persist). No external OAuth. Verbatim from spec.
- byte suggests **only currently-off** items, chosen for the task/topic at hand; never during plain Q&A/status. Task-gated + contextual trigger.
- **One** capability suggestion per message (fits the single-action-per-message wire).
- Touch **none** of Giang's Build Coach files: `InstallView`, `/api/track*`, `app/actions/install.ts`, the installer core.
- byte writes plain text — no markdown/emoji (existing chat rule).
- Confirmation copy reuses `ENV_META.on` (`Connected` / `byte turned this on`) — same meaning as the button.

---

### Task 1: Pure env-setup module (`lib/ai/envSetup.ts`)

The shared, side-effect-free core: the DTO the client sends, the server-side defensive parse + match, and the name→index resolver the store uses to flip an item. Pure functions taking `ENV` as a parameter, so they're fully unit-testable.

**Files:**
- Create: `lib/ai/envSetup.ts`
- Test: `lib/ai/envSetup.test.ts`

**Interfaces:**
- Consumes: `EnvItem` from `@/lib/data`.
- Produces:
  - `type EnvCategory = 'skills' | 'connectors' | 'agents'`
  - `interface SetupItem { category: EnvCategory; name: string; why: string }`
  - `collectSetupItems(env: Record<string, EnvItem[]>): SetupItem[]` — every off item, with `why || d`.
  - `parseSetupItems(raw: unknown): SetupItem[]` — defensive parse of the client-sent list.
  - `matchSetupItem(items: SetupItem[], category: unknown, name: unknown): SetupItem | null` — validate a byte suggestion against the allowed list (case-insensitive name).
  - `resolveEnvIndex(env: Record<string, EnvItem[]>, category: string, name: string): number` — name→index, `-1` if absent.

- [ ] **Step 1: Write the failing test**

Create `lib/ai/envSetup.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  collectSetupItems,
  parseSetupItems,
  matchSetupItem,
  resolveEnvIndex,
  type SetupItem,
} from './envSetup';
import type { EnvItem } from '@/lib/data';

const env: Record<string, EnvItem[]> = {
  skills: [
    { n: 'PRD writer', ab: 'Pr', d: 'spec', s: 1, why: 'specs' },
    { n: 'Code review', ab: 'Cr', d: 'reviews diffs', s: 0, why: 'catch bugs' },
  ],
  connectors: [{ n: 'Notion', ab: 'No', d: 'sync docs', s: 0 }],
  agents: [{ n: 'Explorer', ab: 'Ex', d: 'searches', s: 1 }],
};

describe('collectSetupItems', () => {
  it('returns only off items, with why falling back to d', () => {
    expect(collectSetupItems(env)).toEqual<SetupItem[]>([
      { category: 'skills', name: 'Code review', why: 'catch bugs' },
      { category: 'connectors', name: 'Notion', why: 'sync docs' },
    ]);
  });
});

describe('parseSetupItems', () => {
  it('keeps valid rows and drops junk', () => {
    const raw = [
      { category: 'skills', name: 'Code review', why: 'x' },
      { category: 'bogus', name: 'Nope', why: 'x' },
      { name: 'no category' },
      42,
    ];
    expect(parseSetupItems(raw)).toEqual([{ category: 'skills', name: 'Code review', why: 'x' }]);
  });
  it('returns [] for non-arrays', () => {
    expect(parseSetupItems(undefined)).toEqual([]);
  });
});

describe('matchSetupItem', () => {
  const items = collectSetupItems(env);
  it('matches case-insensitively on category + name', () => {
    expect(matchSetupItem(items, 'connectors', 'notion')?.name).toBe('Notion');
  });
  it('rejects an item not in the allowed (off) list', () => {
    expect(matchSetupItem(items, 'skills', 'PRD writer')).toBeNull(); // already on
    expect(matchSetupItem(items, 'skills', 'invented')).toBeNull();
  });
});

describe('resolveEnvIndex', () => {
  it('finds the index case-insensitively', () => {
    expect(resolveEnvIndex(env, 'skills', 'code review')).toBe(1);
  });
  it('returns -1 for unknown category or name', () => {
    expect(resolveEnvIndex(env, 'skills', 'nope')).toBe(-1);
    expect(resolveEnvIndex(env, 'nope', 'Notion')).toBe(-1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ai/envSetup.test.ts`
Expected: FAIL — `Cannot find module './envSetup'`.

- [ ] **Step 3: Write the module**

Create `lib/ai/envSetup.ts`:

```ts
// Pure core for byte's chat-driven toolkit setup. No side effects — the client uses
// collectSetupItems to tell the server which items are off; the server uses
// parseSetupItems + matchSetupItem to ground and validate a suggestion; the store uses
// resolveEnvIndex to flip the approved item on. ENV is passed in so this stays testable.
import type { EnvItem } from '@/lib/data';

export type EnvCategory = 'skills' | 'connectors' | 'agents';
const CATEGORIES: EnvCategory[] = ['skills', 'connectors', 'agents'];

/** A toolkit item byte may suggest turning on (sent to the server for grounding). */
export interface SetupItem {
  category: EnvCategory;
  name: string;
  why: string;
}

/** Every currently-off toolkit item, in category order — the founder's "could enable" set. */
export function collectSetupItems(env: Record<string, EnvItem[]>): SetupItem[] {
  const out: SetupItem[] = [];
  for (const category of CATEGORIES) {
    for (const x of env[category] ?? []) {
      if (!x.s) out.push({ category, name: x.n, why: x.why || x.d });
    }
  }
  return out;
}

/** Defensively parse the client-sent off-items list (never trust the wire). */
export function parseSetupItems(raw: unknown): SetupItem[] {
  if (!Array.isArray(raw)) return [];
  const out: SetupItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (
      typeof o.category === 'string' &&
      (CATEGORIES as string[]).includes(o.category) &&
      typeof o.name === 'string'
    ) {
      out.push({
        category: o.category as EnvCategory,
        name: o.name,
        why: typeof o.why === 'string' ? o.why : '',
      });
    }
  }
  return out.slice(0, 40);
}

/** Validate a byte suggestion against the allowed (off) list; null if it isn't one. */
export function matchSetupItem(
  items: SetupItem[],
  category: unknown,
  name: unknown,
): SetupItem | null {
  if (typeof category !== 'string' || typeof name !== 'string') return null;
  const n = name.trim().toLowerCase();
  return (
    items.find((i) => i.category === category && i.name.trim().toLowerCase() === n) ?? null
  );
}

/** Index of a named item within its category, or -1. Used to flip it on. */
export function resolveEnvIndex(
  env: Record<string, EnvItem[]>,
  category: string,
  name: string,
): number {
  const list = env[category];
  if (!list) return -1;
  const n = name.trim().toLowerCase();
  return list.findIndex((x) => x.n.trim().toLowerCase() === n);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ai/envSetup.test.ts`
Expected: PASS (4 suites).

- [ ] **Step 5: Typecheck + lint the new files**

Run: `npx tsc --noEmit && npx eslint lib/ai/envSetup.ts lib/ai/envSetup.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/envSetup.ts lib/ai/envSetup.test.ts
git commit -m "feat(env-setup): pure core for chat-driven toolkit setup"
```

---

### Task 2: Server — `setup_capability` tool, grounding, validate + emit (`app/api/chat/route.ts`)

Add the tool, a `SETUP TOOLKIT` grounding block built from the client-sent off items, a system-prompt paragraph with the trigger policy, and the post-stream validate-and-emit of the `setup` action.

**Files:**
- Modify: `app/api/chat/route.ts`

**Interfaces:**
- Consumes: `parseSetupItems`, `matchSetupItem`, `SetupItem` from `@/lib/ai/envSetup`.
- Produces: on the wire, `ACTION_MARK + JSON.stringify({ setup: { category, name } })` when byte validly suggests an off item.

- [ ] **Step 1: Import the env-setup helpers**

Modify the import block near the top (after the `navChip` import at line 14):

```ts
import { NAV_DESTINATIONS } from '@/lib/ai/navChip';
import { parseSetupItems, matchSetupItem, type SetupItem } from '@/lib/ai/envSetup';
```

- [ ] **Step 2: Add the trigger-policy paragraph to `BYTE_SYSTEM`**

In `BYTE_SYSTEM`, immediately before the closing backtick of the string (right after the `navigate` paragraph that ends `…you may still offer to take them).`), append a new paragraph:

```ts
When work you're about to run or discuss would clearly go better with a toolkit item that's currently off — a skill, connector, or agent in the SETUP TOOLKIT list — offer to turn it on and call the setup_capability tool with its exact category and name. Turning it on connects it for the founder right here (no separate setup). Say one short lead-in line first (e.g. "This'll go faster with Code review on — want me to turn it on?") and then call the tool. Rules: only suggest an item that's actually in SETUP TOOLKIT (they're all off); pick the single most relevant one; never raise the toolkit during plain questions, advice, or status — only when it genuinely helps the work at hand.
```

- [ ] **Step 3: Add the `SETUP_TOOL` definition**

After the `NAVIGATE_TOOL` definition (after line 85), add:

```ts
// The tool byte calls to turn on a currently-off toolkit item (skill/connector/agent)
// for the founder. Validated against the SETUP TOOLKIT list (the off items the client
// sent) before we act, so an already-on or invented item is dropped.
const SETUP_TOOL = {
  name: 'setup_capability',
  description:
    "Turn on a currently-off toolkit item for the founder when it would clearly help the work at hand. Use the exact category and name from the SETUP TOOLKIT list. Only call this for an item in that list; for questions, advice, or status, do NOT call it. Always also give a one-line spoken lead-in.",
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      category: {
        type: 'string',
        enum: ['skills', 'connectors', 'agents'],
        description: 'The item’s category, copied exactly from SETUP TOOLKIT.',
      },
      name: {
        type: 'string',
        description: 'The exact item name, copied exactly from SETUP TOOLKIT.',
      },
    },
    required: ['category', 'name'],
  },
};
```

- [ ] **Step 4: Accept `envSetup` in the request body**

Extend the `ChatBody` interface (line 120-124):

```ts
interface ChatBody {
  messages?: unknown;
  deptSummary?: unknown;
  openTasks?: unknown;
  envSetup?: unknown;
}
```

- [ ] **Step 5: Build the grounding block and wire the tool**

After the `runnableBlock` / `system` construction (after line 213), insert the setup block and fold it into the system string. Replace lines 204-213 (the `runnable` block through the `system` assignment) with:

```ts
  // The tasks byte is allowed to run from chat. Included in the prompt so byte uses
  // exact identifiers, and validated on the way back so a hallucinated title can't act.
  const runnable = parseOpenTasks(body.openTasks);
  const runnableBlock = runnable.length
    ? `\n\nRUNNABLE TASKS (call run_task with the exact deptK + taskTitle to produce one here):\n${runnable
        .map(
          (r) =>
            `- deptK:"${r.deptK}" taskTitle:"${r.taskTitle}" — ${r.hint || 'no hint'} (${r.deptName})`,
        )
        .join('\n')}`
    : '\n\nRUNNABLE TASKS: none open right now — if the founder asks you to run something, tell them there are no open tasks to run.';

  // The currently-off toolkit items byte may offer to turn on. Grounded here (exact
  // identifiers) and validated on the way back so an already-on/invented item can't act.
  const setupItems = parseSetupItems(body.envSetup);
  const setupBlock = setupItems.length
    ? `\n\nSETUP TOOLKIT (call setup_capability with the exact category + name to turn one on):\n${setupItems
        .map((s) => `- category:"${s.category}" name:"${s.name}" — ${s.why || 'no note'}`)
        .join('\n')}`
    : '';

  const system = `${BYTE_SYSTEM}\n\nThe founder's company: ${context}${relevantBlock}${deptSummary}${runnableBlock}${setupBlock}`;
```

- [ ] **Step 6: Offer the tool to the model**

Replace the `tools:` line (line 224) with a computed list:

```ts
      tools: [
        NAVIGATE_TOOL,
        ...(runnable.length ? [RUN_TASK_TOOL] : []),
        ...(setupItems.length ? [SETUP_TOOL] : []),
      ],
```

- [ ] **Step 7: Validate + emit the `setup` action**

In the post-stream block, add a `setupUse` finder next to `navUse` (after line 248) and an `else if` branch. Replace lines 245-275 (the `navUse` finder through the end of its `else if` block) with:

```ts
          const navUse = final.content.find(
            (b): b is Extract<typeof b, { type: 'tool_use' }> =>
              b.type === 'tool_use' && b.name === 'navigate',
          );
          const setupUse = final.content.find(
            (b): b is Extract<typeof b, { type: 'tool_use' }> =>
              b.type === 'tool_use' && b.name === 'setup_capability',
          );
          if (toolUse) {
            const input = toolUse.input as { deptK?: unknown; taskTitle?: unknown };
            const taskTitle = typeof input.taskTitle === 'string' ? input.taskTitle : '';
            const deptK = typeof input.deptK === 'string' ? input.deptK : '';
            const match =
              runnable.find((r) => r.deptK === deptK && r.taskTitle === taskTitle) ||
              runnable.find((r) => r.taskTitle === taskTitle);
            if (match) {
              controller.enqueue(
                encoder.encode(
                  ACTION_MARK + JSON.stringify({ deptK: match.deptK, taskTitle: match.taskTitle }),
                ),
              );
            }
          } else if (navUse) {
            // byte wants to guide them somewhere. Emit the destination only if it's a real
            // one; the client resolves it to a chip (and drops it if it can't). target is
            // passed through for a department; the client resolves the exact key/name.
            const input = navUse.input as { destination?: unknown; target?: unknown };
            const dest = typeof input.destination === 'string' ? input.destination : '';
            if ((NAV_DESTINATIONS as readonly string[]).includes(dest)) {
              const target = typeof input.target === 'string' ? input.target : undefined;
              controller.enqueue(
                encoder.encode(ACTION_MARK + JSON.stringify({ nav: dest, target })),
              );
            }
          } else if (setupUse) {
            // byte wants to turn on a toolkit item. Emit it only if it's a real off item
            // from SETUP TOOLKIT; the client renders an approval card and flips it on tap.
            const input = setupUse.input as { category?: unknown; name?: unknown };
            const match: SetupItem | null = matchSetupItem(setupItems, input.category, input.name);
            if (match) {
              controller.enqueue(
                encoder.encode(
                  ACTION_MARK + JSON.stringify({ setup: { category: match.category, name: match.name } }),
                ),
              );
            }
          }
```

- [ ] **Step 8: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint app/api/chat/route.ts`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "feat(chat): setup_capability tool — byte turns on off toolkit items"
```

---

### Task 3: Client transport — `setup` event (`lib/ai/chat.ts`)

Carry the off-items list up and the `setup` action back down.

**Files:**
- Modify: `lib/ai/chat.ts`

**Interfaces:**
- Consumes: `SetupItem` from `@/lib/ai/envSetup`.
- Produces: `ChatEvent` gains `{ type: 'setup'; category: string; name: string }`; `streamByteChat` gains an `envSetup?: SetupItem[]` parameter sent as `body.envSetup`.

- [ ] **Step 1: Import `SetupItem` and extend `ChatEvent`**

After the existing imports (line 7), add:

```ts
import type { SetupItem } from './envSetup';
```

Extend the `ChatEvent` union (lines 19-22):

```ts
export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'action'; deptK: string; taskTitle: string }
  | { type: 'nav'; dest: string; target?: string }
  | { type: 'setup'; category: string; name: string };
```

- [ ] **Step 2: Add the `envSetup` parameter and send it**

Change the signature (lines 37-41) and the fetch body (line 45):

```ts
export async function* streamByteChat(
  history: ChatTurn[],
  deptSummary?: string,
  openTasks?: RunnableTask[],
  envSetup?: SetupItem[],
): AsyncGenerator<ChatEvent> {
```

```ts
    body: JSON.stringify({ messages: history, deptSummary, openTasks, envSetup }),
```

- [ ] **Step 3: Parse the `setup` payload**

In the trailing-payload parse (lines 78-98), extend the parsed shape and add a branch. Replace the `try { ... }` body:

```ts
    try {
      const a = JSON.parse(buf) as {
        deptK?: unknown;
        taskTitle?: unknown;
        nav?: unknown;
        target?: unknown;
        setup?: unknown;
      };
      if (typeof a.deptK === 'string' && typeof a.taskTitle === 'string') {
        yield { type: 'action', deptK: a.deptK, taskTitle: a.taskTitle };
      } else if (typeof a.nav === 'string') {
        yield {
          type: 'nav',
          dest: a.nav,
          target: typeof a.target === 'string' ? a.target : undefined,
        };
      } else if (a.setup && typeof a.setup === 'object') {
        const s = a.setup as { category?: unknown; name?: unknown };
        if (typeof s.category === 'string' && typeof s.name === 'string') {
          yield { type: 'setup', category: s.category, name: s.name };
        }
      }
    } catch {
      /* malformed action payload — ignore, byte's text still delivered */
    }
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint lib/ai/chat.ts`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/chat.ts
git commit -m "feat(chat): carry off-toolkit items up and setup action back down"
```

---

### Task 4: Store — `setup` on messages, `setupCapability` action, sendChat wiring (`lib/store.tsx`)

**Files:**
- Modify: `lib/store.tsx`

**Interfaces:**
- Consumes: `collectSetupItems`, `resolveEnvIndex` from `@/lib/ai/envSetup`; `streamByteChat` `setup` event.
- Produces:
  - `ChatMessage.setup?: { category: string; name: string }`
  - `setupCapability(category: string, name: string): void` on `AppState`.

- [ ] **Step 1: Import the helpers**

Add to the `@/lib/ai/chat`-area imports. After line 41 (`resolveNavChip` import), add:

```ts
import { collectSetupItems, resolveEnvIndex } from './ai/envSetup';
```

- [ ] **Step 2: Add `setup` to `ChatMessage`**

In the `ChatMessage` interface (after the `advance?` field, line 66), add:

```ts
  /** A one-tap "turn this on" card byte offers for an off toolkit item (reads live ENV). */
  setup?: { category: string; name: string };
```

- [ ] **Step 3: Declare `setupCapability` on `AppState`**

Next to `toggleEnv` in the `AppState` interface (line 153), add:

```ts
  toggleEnv: (category: string, index: number) => void;
  setupCapability: (category: string, name: string) => void;
```

- [ ] **Step 4: Implement `setupCapability`**

Immediately after the `toggleEnv` `useCallback` (after line 779), add:

```ts
  // Turn a named toolkit item ON for the founder — byte's "I'll connect it" from chat.
  // Idempotent (never flips an already-on item off) and persisted like toggleEnv.
  const setupCapability = useCallback(
    (category: string, name: string) => {
      const idx = resolveEnvIndex(ENV, category, name);
      if (idx === -1) return;
      const item = ENV[category][idx];
      if (item.s) return; // already on — nothing to do
      item.s = 1;
      bump();
      if (companyId) {
        persistEnv(companyId, envStateFromCatalog()).catch((err) => {
          console.error('[store] persistEnv (setup) failed', err);
        });
      }
    },
    [companyId, bump],
  );
```

- [ ] **Step 5: Compute + send off items and handle the `setup` event in `sendChat`**

In `sendChat`, after the `openTasks` computation (after line 997), add:

```ts
      // The currently-off toolkit items byte may offer to turn on from this turn.
      const envSetup = collectSetupItems(ENV);
```

Pass it to the stream — change the `streamByteChat(...)` call (line 1005):

```ts
          for await (const ev of streamByteChat(history, deptSummary, openTasks, envSetup)) {
```

Add a `setupChip` accumulator next to `navChip` (line 1003):

```ts
        let navChip: NavChip | undefined;
        let setupChip: { category: string; name: string } | undefined;
```

Handle the event inside the loop, after the `nav` branch (after line 1014):

```ts
            if (ev.type === 'setup') {
              setupChip = { category: ev.category, name: ev.name };
              continue;
            }
```

- [ ] **Step 6: Fold `setupChip` into the final message + persistence**

Update the `finalText` fallback chain (lines 1030-1036) to cover a setup-only reply:

```ts
        const finalText =
          acc.trim() ||
          (pending
            ? `On it — running “${pending.taskTitle}”.`
            : navChip
              ? 'Here you go.'
              : setupChip
                ? 'I can turn that on for you — one tap.'
                : fallback);
```

Attach `setup` when writing the final byte message (line 1037-1039):

```ts
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === byteMsg.id ? { ...m, text: finalText, nav: navChip, setup: setupChip } : m,
          ),
        );
```

Include `setupChip` in the persist condition (line 1043):

```ts
        if (companyId && (acc.trim() || pending || navChip || setupChip)) {
```

- [ ] **Step 7: Expose `setupCapability` on the context value**

In the `value` memo, next to `toggleEnv` (line 1099), add `setupCapability,`. In the memo dependency array, next to `toggleEnv` (line 1152), add `setupCapability,`.

- [ ] **Step 8: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint lib/store.tsx`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add lib/store.tsx
git commit -m "feat(store): setupCapability action + carry setup card through chat"
```

---

### Task 5: Client — `SetupCard` in chat (`components/Copilot.tsx` + `app/globals.css`)

Render the approval card and its confirmed state, reading the live ENV item (like `ResultCard` reads the live task), so `bump()` after a flip re-renders it as done.

**Files:**
- Modify: `components/Copilot.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `setupCapability` from the store; `ENV`, `ENV_META` from `@/lib/data`; `resolveEnvIndex` from `@/lib/ai/envSetup`; `ChatMessage.setup`.

- [ ] **Step 1: Import ENV data + resolver**

Change the data import (line 5) and add the resolver import:

```ts
import { DEPTS, ENV, ENV_META } from '@/lib/data';
import { resolveEnvIndex } from '@/lib/ai/envSetup';
```

- [ ] **Step 2: Add the `SetupCard` component**

After the `ResultCard` function (after line 153), add:

```tsx
// A one-tap card byte offers to turn on an off toolkit item. Reads the LIVE ENV item so
// a flip (setupCapability → bump) re-renders this card into its confirmed state.
function SetupCard({ m }: { m: ChatMessage }) {
  const { setupCapability } = useApp();
  const s = m.setup!;
  const idx = resolveEnvIndex(ENV, s.category, s.name);
  if (idx === -1) return null; // stale/unknown item — drop quietly
  const item = ENV[s.category][idx];
  const meta = ENV_META[s.category];
  return (
    <div className="cset">
      <div className="cset-h">
        <span className="cset-ic">{item.ab}</span>
        <span className="cset-cat">{meta.label}</span>
      </div>
      <div className="cset-n">{item.n}</div>
      <div className="cset-why">{item.why || item.d}</div>
      {item.s ? (
        <div className="cset-done">
          <span className="ck">✓</span>
          {meta.on}
        </div>
      ) : (
        <button className="cset-b" onClick={() => setupCapability(s.category, s.name)}>
          {meta.add}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Render it in the message map**

In the `chatMessages.map`, next to the `m.result` short-circuit (line 224), add:

```tsx
          if (m.result) return <ResultCard key={m.id} m={m} />;
          if (m.setup) return <SetupCard key={m.id} m={m} />;
```

- [ ] **Step 4: Add the card styles**

Append to `app/globals.css` (end of file):

```css
/* byte's in-chat "turn this on" toolkit card (SetupCard) */
.cset {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--card);
  padding: 12px 13px;
  margin: 2px 0 4px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cset-h {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cset-ic {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 700;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}
.cset-cat {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}
.cset-n {
  font-weight: 650;
  font-size: 14px;
}
.cset-why {
  font-size: 12.5px;
  color: var(--muted);
  line-height: 1.4;
}
.cset-b {
  align-self: flex-start;
  margin-top: 2px;
  padding: 6px 14px;
  border-radius: 8px;
  border: 0;
  background: var(--accent);
  color: #fff;
  font-weight: 600;
  font-size: 12.5px;
  cursor: pointer;
}
.cset-b:hover {
  filter: brightness(1.05);
}
.cset-done {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--accent);
}
.cset-done .ck {
  font-size: 12px;
}
```

> Note: confirm `--line`, `--card`, `--muted`, `--accent` exist in `:root` in `globals.css` before finishing; if a token differs (e.g. `--border` instead of `--line`), use the project's actual name. Grep: `grep -nE '^\s*--(line|card|muted|accent|border):' app/globals.css`.

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint components/Copilot.tsx`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/Copilot.tsx app/globals.css
git commit -m "feat(chat): SetupCard — one-tap turn on a toolkit item byte suggests"
```

---

### Task 6: Full-project gates + preview verification

**Files:** none (verification only).

- [ ] **Step 1: Full test + lint + build**

Run:
```bash
npx vitest run
npx eslint .
npx prettier --check .
npx next build
```
Expected: all green. (Full `eslint .` guards the tracked `eslint-suppressions.json` gotcha.)

- [ ] **Step 2: Push + open PR**

```bash
git push -u origin feat/chat-toolkit-setup
gh pr create --title "byte drives the toolkit from chat" --body "byte suggests an off toolkit item in chat; one-tap approve turns it on (in-app flip, persisted). Rides the run_task/navigate tool rails. Spec + plan in docs/superpowers/."
```

- [ ] **Step 3: Verify on the Vercel PR preview (not `next dev`)**

On the preview URL, in a company whose brief implies a need (e.g. a beta launch):
- Ask byte something task-shaped, e.g. "help me catch bugs before the beta ships" or "run a code review before I ship."
- Confirm a `SetupCard` appears for an off item (e.g. Code review) with a lead-in line — and does NOT appear for plain Q&A like "what's my roadmap?".
- Tap the button → card flips to `✓ byte turned this on` / `✓ Connected`.
- Open the Environment view → the item now shows on. Reload → still on (Firestore persisted).
- Ask byte to turn on something already on → no card appears (validated away).

- [ ] **Step 4: Merge so it reaches prod**

After preview verification and review, merge the PR. Vercel redeploys prod (committed ≠ merged ≠ deployed).

---

## Self-Review

- **Spec coverage:** loop (Tasks 2-5), in-app flip only (Task 4 `setupCapability`, Global Constraints), grounding block (Task 2 Step 5), `setup_capability` tool + validation (Tasks 1-2), `SetupCard` + `ENV_META` copy (Task 5), trigger policy (Task 2 Step 2), one-per-message (single-action wire, Tasks 2-3), no Giang files (Global Constraints), testing + preview (Tasks 1, 6). All covered.
- **Placeholder scan:** none — every code step carries full code; the one note (CSS token names) is a verify-the-name instruction with an exact grep, not a TODO.
- **Type consistency:** `SetupItem`/`EnvCategory` defined in Task 1 and consumed unchanged in Tasks 2-4; `ChatMessage.setup` shape `{ category, name }` defined in Task 4 and read in Task 5; `setupCapability(category, name)` signature identical across AppState decl (Task 4 Step 3), impl (Step 4), and call site (Task 5 Step 2); wire key `setup:{category,name}` identical in emit (Task 2), parse (Task 3), and consume (Task 4).
