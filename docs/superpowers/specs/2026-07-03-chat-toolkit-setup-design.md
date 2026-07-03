# byte drives the toolkit from chat

**Date:** 2026-07-03
**Branch:** `feat/chat-toolkit-setup` (off `origin/main`)
**Status:** approved design

## Problem

The Environment view (`components/views/EnvironmentView.tsx`) lists byte's toolkit —
skills, connectors, and agents — with Turn on / Connect / Enable buttons that flip an
in-app on/off state. But the page is a dead end: byte never references the toolkit while
chatting, so the founder has to know on their own which capability to enable and when.

We want byte to close that loop: while chatting, when a toolkit item would improve the
work at hand, byte suggests it; the founder approves with one tap; byte turns it on.

## What "connect" means (scope boundary)

"Connect" is an **in-app state flip** — `toggleEnv(category, index)` sets the item's `s`
flag and persists to Firestore, exactly like the Environment buttons already do. This is
honest and consistent with the rest of the demo (GitHub/Notion already show "Connected"
this way). **No real external OAuth** — that is explicitly out of scope and would be a
separate project.

## Non-goals

- Real OAuth / live API connections to GitHub, Notion, Slack, etc.
- Batch suggestions (multiple capabilities in one message).
- Any change to Giang's Build Coach surface: `InstallView`, `/api/track*`,
  `app/actions/install.ts`, the installer core. This feature does not touch them.

## The loop

1. Founder chats with byte.
2. byte is about to run/discuss work a toolkit item would improve (task-gated), **or** the
   topic clearly calls for one (contextual). byte says one short lead-in line and calls the
   `setup_capability` tool.
3. Server validates the suggested item against the live ENV catalog + current state; emits
   a `setup` action on the existing stream only if the item exists and is currently **off**.
4. Client renders a `SetupCard` with a Turn on / Connect button.
5. Founder taps → client calls `toggleEnv(category, index)` → item flips on in the
   Environment view + Firestore; the card shows its confirmed state.

This mirrors the existing `run_task` / `navigate` tool pattern — same rails, third tool.

## Trigger policy (task-gated + contextual)

byte suggests a capability when it is running/attempting work the capability would improve,
or when the conversation clearly needs one. It does **not** volunteer toolkit items during
plain Q&A, status checks, or advice. Gated the same way `run_task` is gated to real tasks —
grounded, not salesy. One short spoken lead-in line, then the tool call.

## Components

### 1. Grounding: `ENVIRONMENT TOOLKIT` context block
`app/api/chat/route.ts` injects a block (sibling of `RUNNABLE TASKS`) listing each toolkit
item: `category`, `name`, one-line `why`/`d`, and on/off state. byte is instructed to only
suggest items currently **off**, choosing the one most relevant to the task/topic.
A small serializer in `lib/data.ts` produces this from the live `ENV` state.

### 2. Tool: `setup_capability`
Added to the chat tools alongside `run_task` and `navigate`.
- Input schema: `{ category: 'skills' | 'connectors' | 'agents', name: string }`.
- Server: after `finalMessage()`, find a `tool_use` block named `setup_capability`.
  Validate `category` is one of the three and `name` matches an item in `ENV[category]`
  that is currently **off**. On match, emit `ACTION_MARK + JSON.stringify({ setup: { category, name } })`.
  On any mismatch (invented/already-on item), drop silently — same defensive posture as
  `run_task`'s exact-title match.

### 3. Client: `SetupCard`
A sibling of `ResultCard` in `components/Copilot.tsx`.
- Parses the `setup` action off the stream onto the message (like `m.result` / `m.nav`).
- Renders the item's abbreviation icon, name, category label, and "why" line, styled to
  match the recommended cards (`ENV_META` for label/verb/confirm copy + accent color).
- Button verb per category via `ENV_CATS` (`Turn on` / `Connect` / `Enable`).
- On tap: resolve `name → index` within `ENV[category]`, call `toggleEnv(category, index)`,
  then render the confirmed state (`✓ Connected` / `✓ byte turned this on`) from `ENV_META.on`.
- One suggestion per message (fits the existing single-action-per-message wire).

### 4. byte's behavior (system prompt)
A short section describing the toolkit, the trigger policy above, and honest confirmation
language (a flip means byte now treats the item as connected — the same meaning as the
button). Instruct: suggest only currently-off items; one lead-in line then the tool call;
never during plain Q&A/status.

## Data flow

```
founder message
  → POST /api/chat  (context now includes ENVIRONMENT TOOLKIT block)
  → Claude streams text, may emit setup_capability tool_use
  → server validates {category,name} against live ENV (must exist + be off)
  → stream: <text> ACTION_MARK {"setup":{"category","name"}}
  → client splits ACTION_MARK, attaches setup to message
  → SetupCard renders → founder taps → toggleEnv(category, index)
  → EnvironmentView + Firestore reflect the flip; card shows confirmed
```

## Error handling

- Invalid / already-on / invented item → server emits no action; byte's text still shows.
- `toggleEnv` failure to persist is already handled by the store (same path as buttons).
- Only one action type is emitted per message; `setup` is mutually exclusive with
  `run_task` / `navigate` in a single reply (matches current wire).

## Files touched

| File | Change |
|------|--------|
| `app/api/chat/route.ts` | `SETUP_TOOL` def, `ENVIRONMENT TOOLKIT` grounding block, validate + emit `setup` action, prompt section |
| `components/Copilot.tsx` | parse `setup` action, `SetupCard` component |
| `lib/store.tsx` | (if needed) name-based `setupCapability(category, name)` helper wrapping `toggleEnv`, or resolve index in the card |
| `lib/data.ts` | serializer for ENV state grounding + name→index lookup helper |

None of Giang's Build Coach files are touched.

## Testing

- Unit: ENV serializer (on/off states rendered correctly), name→index resolution,
  server validation (rejects invented / already-on items, accepts a valid off item).
- Manual on Vercel PR preview (not `next dev`, per the first-run verification note):
  ask byte to run/discuss work that maps to an off capability → confirm the SetupCard
  appears → approve → confirm the Environment view now shows it on and it persists.

## Ship

Built in an isolated worktree off `origin/main`; verify on the Vercel PR preview; PR →
merge so it reaches prod (committed ≠ merged ≠ deployed).
