# Chat history tab (byte conversation threads) — design

**Date:** 2026-07-07
**Status:** Approved design, pending implementation plan
**Repo:** `My-Outcasts/Codepet-ver-1.2`

## Problem

byte's chat is a docked side panel (`components/Copilot.tsx`). Messages already
persist to Firestore at `companies/{companyId}/chat/{msgId}` as **one single,
ever-growing thread per company**, re-hydrated wholesale on load. There is no
notion of separate conversations, so a founder can't start a fresh chat or
revisit an earlier one — the whole history is one undifferentiated scroll.

## Goal

Add a Codex-style chat history: **manually-created conversation threads** the
founder can browse and reopen from within the docked chat panel. Reopening a
thread resumes it (continue chatting), matching Codex/ChatGPT.

## Decisions (locked during brainstorming)

| Decision        | Choice                                                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Thread model    | Manual **"New chat"** — user explicitly creates threads                                                                                               |
| History UI      | **In-panel flip** — a header button flips the docked panel between the active thread and a thread-list view (mobile-ChatGPT style); chat stays docked |
| Thread titles   | **Auto from the first message** (~40 chars), with optional manual rename. No model call.                                                              |
| Storage         | **Approach A** — a `threadId` field on the existing `chat` messages + a new `threads` metadata collection                                             |
| Migration       | **Lazy backfill on load**, idempotent                                                                                                                 |
| Reopen behavior | **Resume** (continue the conversation)                                                                                                                |

## Data model (Approach A)

### New collection

`companies/{companyId}/threads/{threadId}` → `ThreadMeta`:

```ts
interface ThreadMeta {
  id: string; // thread id
  title: string; // derived from first message; user-renameable
  createdAt: number; // ms epoch
  updatedAt: number; // ms epoch — bumped on each new message; drives list sort + "2h ago"
}
```

New path helpers in `lib/firebase/schema.ts`:

```ts
threads: (companyId) => `companies/${companyId}/threads`;
thread: (companyId, threadId) => `companies/${companyId}/threads/${threadId}`;
```

### Existing message docs

Messages stay at `companies/{companyId}/chat/{msgId}` (unchanged path). Each
message doc gains a field:

```ts
threadId: string; // which thread this message belongs to
```

`ChatMessage` (in `lib/store.tsx`) and the message doc type (`lib/firebase/schema.ts`)
both gain `threadId`.

### Firestore index

One composite index on the `chat` collection, added to `firestore.indexes.json`:
`threadId ASC, createdAt ASC` — lets us load a single thread's messages in order.

## Migration — lazy backfill on load

On company load, in `loadCompanyData` (or a helper it calls):

1. Load the `threads` collection.
2. **If** `threads` is empty **and** `chat/*` has ≥1 message → run backfill:
   - Determine the earliest message's `createdAt`.
   - Create one legacy `ThreadMeta` (`id` = a freshly generated thread id;
     `title` = `deriveThreadTitle(firstMessage.text)`; `createdAt` = earliest ts;
     `updatedAt` = latest ts).
   - Batch-write `threadId` onto every existing `chat/*` doc.
3. Proceed with the normal load path.

Idempotent: guarded by "no threads yet," so it runs exactly once per company on
its next load and never re-runs. No separate migration script; existing users
keep their entire conversation as their first history entry.

## Store & state (`lib/store.tsx`)

New state:

```ts
threads: ThreadMeta[]            // sorted by updatedAt desc for the list
activeThreadId: string | null    // the thread whose messages are in chatMessages
chatHistoryOpen: boolean         // panel showing the thread list (true) vs the active thread (false)
```

`chatMessages` now holds **only the active thread's** messages.

New actions:

- `newChat()` — sets a _pending_ new thread: `activeThreadId` = a fresh id,
  `chatMessages` = `[]`, flips back to the thread view. **No Firestore write yet.**
- `openThread(id)` — set active, load that thread's messages into `chatMessages`,
  flip back to thread view.
- `renameThread(id, title)` — update `ThreadMeta.title` (in memory + persist).
- `deleteThread(id)` — remove the thread doc + its messages; if it was active,
  fall back to the next most-recent thread, or a fresh `newChat()` if none remain.
- `toggleChatHistory(open?)` — show/hide the thread list within the panel.

`sendChat` change: on the **first** message of a pending thread, create the
`ThreadMeta` (title from the message) and persist it before/with the message.
Every persisted message bumps its thread's `updatedAt`.

## Firebase layer (`lib/firebase/companyData.ts`)

- `loadThreads(companyId): ThreadMeta[]`
- `loadThreadMessages(companyId, threadId): ChatMessageDoc[]` (query `chat` where
  `threadId ==`, order by `createdAt`)
- `persistThread(companyId, thread)` — create/update a `ThreadMeta`
- `deleteThreadAndMessages(companyId, threadId)` — delete the thread doc and its
  messages (batched)
- `persistChatMessage(companyId, message)` — unchanged write to `chat/{id}`, now
  also bumps the parent thread's `updatedAt`
- `loadCompanyData` — no longer loads _all_ chat. Returns the threads list + the
  most-recently-updated thread's messages (the active thread on hydrate).

## UX flow (in-panel flip)

**On load:** active thread = most recently updated; its messages hydrate into
`chatMessages`; the panel opens to it exactly as today.

**Thread view (default):** a header control **"☰ History"** flips the panel to
the list.

**Thread list view:**

- `[+ New chat]` pinned at top.
- Rows sorted by `updatedAt` desc: **title** + **relative time** ("2h ago").
- Each row has a `⋯` menu: **Rename**, **Delete**.
- Tap a row → `openThread` → flip back to the thread view.

**New chat:** `newChat()` → empty thread view (quick-start suggestions shown, as
today for an empty thread). The thread is created in Firestore only on the first
sent message, titled from it.

**Rename:** inline edit / small prompt → `renameThread`.

**Delete:** `deleteThread` with the fallback described above.

## Title logic

Pure helper (co-located with chat helpers, unit-tested):

```ts
deriveThreadTitle(text: string): string
// trim → collapse whitespace → first ~40 chars → add ellipsis if truncated
// empty/whitespace → "New chat"
```

Used for new-thread titles and the migration's legacy-thread title. Manual
rename overrides it permanently.

## Non-goals (YAGNI)

- **No AI-generated titles** (cost).
- **No cross-thread search**, export, or sharing.
- **Inline deliverable cards stay session-only.** ResultCard / SetupCard /
  arrival-brief messages are transient today and remain so. A reopened thread
  shows the **text conversation** (role `me` / `byte` messages) — identical to
  how a reload behaves now. Persisting rich cards is a separate future feature.
- No multi-select / bulk actions on threads.

## Edge cases

- **Switching threads mid-stream:** disallow (or cancel streaming first) — don't
  interleave a streaming response into a thread the user navigated away from.
- **Transient brief messages** (`m.brief`) are per-session and per-active-thread;
  they are dropped on thread switch (never persisted), as today.
- **Empty pending thread never sent:** no Firestore write, so it simply vanishes
  on reload / thread switch — no ghost rows.
- **Delete active thread with streaming in flight:** cancel streaming, then
  delete and fall back.

## Testing

Unit (pure logic):

- `deriveThreadTitle` — truncation, whitespace, empty → "New chat".
- Thread list sort by `updatedAt` desc.
- Backfill-needed decision (threads empty + messages present).
- Delete-fallback selection (next most-recent, else fresh new chat).

Behavioral QA on the **Vercel preview** (prod build), not `next dev` (StrictMode
double-mount + HMR muddy hydration/persistence): new chat → send → title appears
in list → switch away → reopen (messages restored) → rename → delete (fallback
correct) → reload (active thread + list restored). Verify an existing company's
legacy conversation appears as one backfilled thread after its first load.

## Out-of-scope follow-ups (noted, not built here)

- Persisting inline deliverable cards so reopened threads show them.
- Cross-thread search.
- AI-summarized titles.
