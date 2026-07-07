# byte Chat History Threads — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give byte's docked chat a Codex-style history — manually-created conversation threads the founder can browse and reopen from within the panel.

**Architecture:** Add a `threads` metadata collection and a `threadId` field on existing chat messages (spec "Approach A"). Pure thread logic lives in a new `lib/chat/threads.ts`; the Firestore layer (`lib/firebase/companyData.ts`) gains thread load/persist/delete + a lazy idempotent backfill; the store (`lib/store.tsx`) owns thread state + actions and routes all message persistence through one `threadId`-injecting wrapper; the UI (`components/Copilot.tsx`) flips the docked panel between the active thread and a thread list.

**Tech Stack:** Next.js (App Router), React, TypeScript, Firebase Firestore (modular SDK), Vitest.

## Global Constraints

- **Testing:** unit tests use **Vitest** (`npx vitest run <file>`). Pure logic in `lib/*` is unit-tested; store/firebase/UI integration is gated by **typecheck** (`npx tsc --noEmit`) + **build** (`npm run build`) and verified behaviorally on the **Vercel preview** (prod build), NOT `next dev` (StrictMode double-mount + resetCompanyData muddy hydration).
- **Worktree setup:** this branch's worktree has no `node_modules`. Before running any check, symlink it once from the main checkout: `ln -s "/Users/monatruong/Desktop/Codepet v1.2/node_modules" node_modules`. (Symlinked node_modules runs checks fine but breaks `next dev` — that's expected; verify UI on preview.)
- **IDs:** generate thread ids with the existing pattern — `crypto.randomUUID()`.
- **Titles:** thread titles derive from the first founder message, max 40 chars + `…`; empty ⇒ `"New chat"`. No model calls anywhere in this feature.
- **Time type:** Firestore docs use `Millis` (ms epoch `number`); UI `ChatMessage.ts` is the same ms epoch.
- **Non-goals:** no AI titles, no cross-thread search/export, no persistence of inline deliverable cards (ResultCard/SetupCard/brief remain session-only). Reopened threads show text messages only.

---

## File Structure

- **Create** `lib/chat/threads.ts` — pure thread logic (title, sort, backfill decision, delete fallback, relative time). No Firebase imports.
- **Create** `lib/chat/threads.test.ts` — Vitest unit tests for the above.
- **Modify** `lib/firebase/schema.ts` — add `ThreadMeta`, add `threadId` to `ChatMessageDoc`, add `paths.threads` / `paths.thread`.
- **Modify** `firestore.indexes.json` — composite index on the `chat` collection.
- **Modify** `lib/firebase/companyData.ts` — thread load/persist/delete/backfill; `persistChatMessage` gains `threadId` + touches the thread; `loadCompanyData` returns threads + active thread.
- **Modify** `lib/store.tsx` — thread state + actions; `persistMsg` wrapper; hydration + `sendChat` thread creation.
- **Modify** `components/Copilot.tsx` — header History button + thread-list view.
- **Modify** `app/globals.css` — thread-list styles.

---

## Task 1: Schema types, paths, and Firestore index

**Files:**

- Modify: `lib/firebase/schema.ts` (add `ThreadMeta`, `threadId` on `ChatMessageDoc`, two path helpers)
- Modify: `firestore.indexes.json`

**Interfaces:**

- Produces: `interface ThreadMeta { id: string; title: string; createdAt: Millis; updatedAt: Millis }`; `ChatMessageDoc` now includes `threadId: string`; `paths.threads(companyId)`, `paths.thread(companyId, threadId)`.

- [ ] **Step 1: Add `ThreadMeta` and `threadId`** in `lib/firebase/schema.ts`. Replace the existing `ChatMessageDoc` block:

```ts
/** One byte-chat message. 'me' = the founder, 'byte' = the companion. */
export interface ChatMessageDoc {
  id: string;
  role: 'me' | 'byte';
  text: string;
  createdAt: Millis;
  /** Which conversation thread this message belongs to. */
  threadId: string;
}

/** One conversation thread (a "history entry") for a company's byte chat. */
export interface ThreadMeta {
  id: string;
  /** Derived from the first founder message; user-renameable. */
  title: string;
  createdAt: Millis;
  /** Bumped on each new message; drives list sort + relative time. */
  updatedAt: Millis;
}
```

- [ ] **Step 2: Add path helpers.** In the `paths` object in `lib/firebase/schema.ts`, immediately after the `chatMessage:` line, add:

```ts
  threads: (companyId: string) => `companies/${companyId}/threads`,
  thread: (companyId: string, threadId: string) =>
    `companies/${companyId}/threads/${threadId}`,
```

- [ ] **Step 3: Add the composite index.** In `firestore.indexes.json`, set `indexes` to:

```json
[
  {
    "collectionGroup": "chat",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "threadId", "order": "ASCENDING" },
      { "fieldPath": "createdAt", "order": "ASCENDING" }
    ]
  }
]
```

- [ ] **Step 4: Typecheck.**

Run: `npx tsc --noEmit`
Expected: PASS (adding a required `threadId` to `ChatMessageDoc` will surface type errors at every construction site — those are fixed in Tasks 3–4; if you run this standalone it may report them, which is expected. Confirm only the `schema.ts` edits themselves are error-free.)

- [ ] **Step 5: Commit.**

```bash
git add lib/firebase/schema.ts firestore.indexes.json
git commit -m "feat(chat): add ThreadMeta type, threadId field, thread paths + index"
```

---

## Task 2: Pure thread logic (`lib/chat/threads.ts`)

**Files:**

- Create: `lib/chat/threads.ts`
- Test: `lib/chat/threads.test.ts`

**Interfaces:**

- Consumes: `ThreadMeta` from `@/lib/firebase/schema`.
- Produces:
  - `deriveThreadTitle(text: string): string`
  - `sortThreadsByRecent(threads: ThreadMeta[]): ThreadMeta[]`
  - `needsBackfill(threadCount: number, messageCount: number): boolean`
  - `pickFallbackThreadId(threads: ThreadMeta[], deletedId: string): string | null`
  - `relativeTime(ts: number, now: number): string`

- [ ] **Step 1: Write the failing tests.** Create `lib/chat/threads.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  deriveThreadTitle,
  sortThreadsByRecent,
  needsBackfill,
  pickFallbackThreadId,
  relativeTime,
} from './threads';
import type { ThreadMeta } from '@/lib/firebase/schema';

const t = (id: string, updatedAt: number): ThreadMeta => ({
  id,
  title: id,
  createdAt: updatedAt,
  updatedAt,
});

describe('deriveThreadTitle', () => {
  it('uses the message, collapsing whitespace', () => {
    expect(deriveThreadTitle('  Help me   draft copy ')).toBe('Help me draft copy');
  });
  it('truncates to 40 chars with an ellipsis', () => {
    const long = 'Draft the landing page hero copy for the new pricing tiers';
    expect(deriveThreadTitle(long)).toBe('Draft the landing page hero copy for the…');
  });
  it('falls back to "New chat" for empty/whitespace', () => {
    expect(deriveThreadTitle('   ')).toBe('New chat');
    expect(deriveThreadTitle('')).toBe('New chat');
  });
});

describe('sortThreadsByRecent', () => {
  it('sorts by updatedAt descending without mutating input', () => {
    const input = [t('a', 1), t('b', 3), t('c', 2)];
    expect(sortThreadsByRecent(input).map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(input.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('needsBackfill', () => {
  it('is true only when no threads but messages exist', () => {
    expect(needsBackfill(0, 5)).toBe(true);
    expect(needsBackfill(1, 5)).toBe(false);
    expect(needsBackfill(0, 0)).toBe(false);
  });
});

describe('pickFallbackThreadId', () => {
  it('returns the most-recent remaining thread', () => {
    expect(pickFallbackThreadId([t('a', 1), t('b', 3), t('c', 2)], 'b')).toBe('c');
  });
  it('returns null when nothing remains', () => {
    expect(pickFallbackThreadId([t('a', 1)], 'a')).toBeNull();
  });
});

describe('relativeTime', () => {
  const now = 1_000_000_000_000;
  it('formats recent times', () => {
    expect(relativeTime(now, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2d ago');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail.**

Run: `npx vitest run lib/chat/threads.test.ts`
Expected: FAIL — cannot resolve `./threads`.

- [ ] **Step 3: Implement `lib/chat/threads.ts`.**

```ts
import type { ThreadMeta } from '@/lib/firebase/schema';

const TITLE_MAX = 40;

/** Title a thread from its first founder message. No model call. */
export function deriveThreadTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return 'New chat';
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX).trimEnd()}…` : clean;
}

/** Newest-first by updatedAt. Does not mutate the input. */
export function sortThreadsByRecent(threads: ThreadMeta[]): ThreadMeta[] {
  return [...threads].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** A company needs the legacy flat chat migrated when it has messages but no threads. */
export function needsBackfill(threadCount: number, messageCount: number): boolean {
  return threadCount === 0 && messageCount > 0;
}

/** After deleting the active thread, which thread should become active (or null → new chat). */
export function pickFallbackThreadId(threads: ThreadMeta[], deletedId: string): string | null {
  const remaining = sortThreadsByRecent(threads.filter((t) => t.id !== deletedId));
  return remaining.length ? remaining[0].id : null;
}

/** Compact relative time for the history list. */
export function relativeTime(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
```

- [ ] **Step 4: Run tests to verify they pass.**

Run: `npx vitest run lib/chat/threads.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit.**

```bash
git add lib/chat/threads.ts lib/chat/threads.test.ts
git commit -m "feat(chat): pure thread logic (title, sort, backfill, fallback, relative time)"
```

---

## Task 3: Firestore thread layer + migration (`lib/firebase/companyData.ts`)

**Files:**

- Modify: `lib/firebase/companyData.ts`

**Interfaces:**

- Consumes: `deriveThreadTitle`, `needsBackfill`, `sortThreadsByRecent` from `@/lib/chat/threads`; `ThreadMeta`, `ChatMessageDoc`, `paths` from `./schema`.
- Produces:
  - `loadThreads(companyId: string): Promise<ThreadMeta[]>`
  - `loadThreadMessages(companyId: string, threadId: string): Promise<ChatMessageDoc[]>`
  - `persistThread(companyId: string, thread: ThreadMeta): Promise<void>`
  - `updateThreadTitle(companyId: string, threadId: string, title: string): Promise<void>`
  - `deleteThreadAndMessages(companyId: string, threadId: string): Promise<void>`
  - `persistChatMessage(companyId, message: ChatMessageDoc): Promise<void>` (now requires `threadId`; touches the thread's `updatedAt`)
  - `CompanyData` now includes `threads: ThreadMeta[]` and `activeThreadId: string | null`; `loadCompanyData` populates them and runs the backfill.

- [ ] **Step 1: Add imports.** At the top of `lib/firebase/companyData.ts`, add `type ThreadMeta` to the schema import group, and add:

```ts
import { deriveThreadTitle, needsBackfill, sortThreadsByRecent } from '@/lib/chat/threads';
```

- [ ] **Step 2: Update `persistChatMessage`** (currently ~line 245) to touch the thread:

```ts
export async function persistChatMessage(
  companyId: string,
  message: ChatMessageDoc,
): Promise<void> {
  const db = getDb();
  await setDoc(doc(db, paths.chatMessage(companyId, message.id)), message);
  // Bump the parent thread so the history list re-sorts / shows fresh relative time.
  await setDoc(
    doc(db, paths.thread(companyId, message.threadId)),
    { updatedAt: message.createdAt },
    { merge: true },
  );
}
```

- [ ] **Step 3: Add thread CRUD + backfill helpers** (place after `persistChatMessage`):

```ts
export async function loadThreads(companyId: string): Promise<ThreadMeta[]> {
  const snap = await getDocs(collection(getDb(), paths.threads(companyId)));
  return snap.docs.map((d) => d.data() as ThreadMeta);
}

export async function loadThreadMessages(
  companyId: string,
  threadId: string,
): Promise<ChatMessageDoc[]> {
  const snap = await getDocs(
    query(
      collection(getDb(), paths.chat(companyId)),
      where('threadId', '==', threadId),
      orderBy('createdAt', 'asc'),
      limit(CHAT_LOAD_LIMIT),
    ),
  );
  return snap.docs.map((d) => d.data() as ChatMessageDoc);
}

export async function persistThread(companyId: string, thread: ThreadMeta): Promise<void> {
  await setDoc(doc(getDb(), paths.thread(companyId, thread.id)), thread);
}

export async function updateThreadTitle(
  companyId: string,
  threadId: string,
  title: string,
): Promise<void> {
  await setDoc(doc(getDb(), paths.thread(companyId, threadId)), { title }, { merge: true });
}

export async function deleteThreadAndMessages(companyId: string, threadId: string): Promise<void> {
  const db = getDb();
  const msgs = await getDocs(
    query(collection(db, paths.chat(companyId)), where('threadId', '==', threadId)),
  );
  const batch = writeBatch(db);
  msgs.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, paths.thread(companyId, threadId)));
  await batch.commit();
}

/**
 * One-time migration: fold a company's pre-threads flat `chat/*` into a single
 * "first conversation" thread. Caller guarantees threads are empty. Returns the
 * created thread, or null if there were no legacy messages.
 */
async function backfillLegacyThread(companyId: string): Promise<ThreadMeta | null> {
  const db = getDb();
  const legacySnap = await getDocs(
    query(collection(db, paths.chat(companyId)), orderBy('createdAt', 'asc')),
  );
  const legacy = legacySnap.docs.map((d) => d.data() as ChatMessageDoc);
  if (!needsBackfill(0, legacy.length)) return null;

  const id = crypto.randomUUID();
  const thread: ThreadMeta = {
    id,
    title: deriveThreadTitle(legacy[0].text),
    createdAt: legacy[0].createdAt,
    updatedAt: legacy[legacy.length - 1].createdAt,
  };
  const batch = writeBatch(db);
  batch.set(doc(db, paths.thread(companyId, id)), thread);
  legacy.forEach((m) =>
    batch.set(doc(db, paths.chatMessage(companyId, m.id)), { threadId: id }, { merge: true }),
  );
  await batch.commit();
  return thread;
}
```

- [ ] **Step 4: Extend `CompanyData`** (the interface near line 148). Replace the `chat` field's block with:

```ts
  /** The active thread's messages, oldest-first. */
  chat: ChatMessageDoc[];
  /** All conversation threads (history entries). */
  threads: ThreadMeta[];
  /** The thread whose messages are in `chat` (most-recent), or null if none. */
  activeThreadId: string | null;
```

- [ ] **Step 5: Rewire `loadCompanyData`.** Replace the `chatSnap` query in the `Promise.all` (lines ~190–195) with a threads query, and replace the chat-mapping tail (lines ~211–214 `const chat = ...`) plus the `return {` block. Concretely:

In the `Promise.all` array, replace the 4th element (the `getDocs(query(collection(db, paths.chat(...))...))`) with:

```ts
    getDocs(collection(db, paths.threads(companyId))),
```

and rename the destructured `chatSnap` to `threadSnap`.

Then, after the `library` mapping and before `return {`, replace the old `const chat = ...` line with:

```ts
// Threads + the active thread's messages. Migrate legacy flat chat on first load.
let threads = threadSnap.docs.map((d) => d.data() as ThreadMeta);
if (threads.length === 0) {
  const migrated = await backfillLegacyThread(companyId);
  if (migrated) threads = [migrated];
}
const activeThreadId = sortThreadsByRecent(threads)[0]?.id ?? null;
const chat = activeThreadId ? await loadThreadMessages(companyId, activeThreadId) : [];
```

Finally, add `threads` and `activeThreadId` to the returned object:

```ts
return {
  // ...existing fields...
  chat,
  threads,
  activeThreadId,
  decisions,
};
```

- [ ] **Step 6: Typecheck + build.**

Run: `npx tsc --noEmit`
Expected: errors ONLY at `persistChatMessage` call sites in `lib/store.tsx` (missing `threadId`) — those are fixed in Task 4. `companyData.ts` itself must be error-free.

- [ ] **Step 7: Commit.**

```bash
git add lib/firebase/companyData.ts
git commit -m "feat(chat): firestore thread layer + lazy legacy backfill"
```

---

## Task 4: Store state, actions, and message routing (`lib/store.tsx`)

**Files:**

- Modify: `lib/store.tsx`

**Interfaces:**

- Consumes: everything from Task 3 (`loadThreads` unused here, `loadThreadMessages`, `persistThread`, `updateThreadTitle`, `deleteThreadAndMessages`); `deriveThreadTitle`, `pickFallbackThreadId` from `@/lib/chat/threads`; `ThreadMeta` from schema.
- Produces (added to the context interface + provider value):
  - state: `threads: ThreadMeta[]`, `activeThreadId: string | null`, `chatHistoryOpen: boolean`
  - actions: `newChat(): void`, `openThread(id: string): void`, `renameThread(id: string, title: string): void`, `deleteThread(id: string): void`, `toggleChatHistory(open?: boolean): void`

- [ ] **Step 1: Add imports.** In `lib/store.tsx`, add to the `./firebase/companyData` import group: `loadThreadMessages`, `persistThread`, `updateThreadTitle`, `deleteThreadAndMessages`. Add a new import:

```ts
import { deriveThreadTitle, pickFallbackThreadId } from './chat/threads';
import type { ThreadMeta } from './firebase/schema';
```

- [ ] **Step 2: Add state** near `const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);` (line ~241):

```ts
const [threads, setThreads] = useState<ThreadMeta[]>([]);
const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
const [chatHistoryOpen, setChatHistoryOpen] = useState(false);
const pendingThreadRef = useRef(false); // true ⇒ active thread not yet written to Firestore
```

- [ ] **Step 3: Add the `persistMsg` wrapper** (place after the state, before the actions that use it). This is the single injection point for `threadId`:

```ts
// Every persisted chat message carries the active thread id. Route all persistence
// through here so no call site forgets it.
const persistMsg = useCallback(
  (msg: { id: string; role: 'me' | 'byte'; text: string; ts: number }) => {
    if (!companyId || !activeThreadId) return;
    persistChatMessage(companyId, {
      id: msg.id,
      role: msg.role,
      text: msg.text,
      createdAt: msg.ts,
      threadId: activeThreadId,
    }).catch((err) => console.error('[store] persist message failed', err));
  },
  [companyId, activeThreadId],
);
```

- [ ] **Step 4: Replace every direct `persistChatMessage(companyId, {...})` call** in `lib/store.tsx` (call sites at approx lines 398, 1515, 1544, 1592, 1625, 1726, 1761) with a `persistMsg({...})` call. Each currently looks like:

```ts
persistChatMessage(companyId, {
  id: X.id,
  role: 'byte',
  text: X.text,
  createdAt: X.ts,
}).catch(/* ... */);
```

becomes:

```ts
persistMsg({ id: X.id, role: X.role, text: X.text, ts: X.ts });
```

(Drop the now-redundant `.catch` — `persistMsg` handles it. Preserve each call's own `id/role/text/ts` values.) After this, remove the now-unused direct `persistChatMessage` import ONLY IF no direct calls remain.

- [ ] **Step 5: Create the thread on the first send in `sendChat`** (line ~1529). Immediately after `if (companyId) {` and before the user-message persist, insert thread creation, then swap the persist call:

```ts
if (companyId) {
  if (pendingThreadRef.current && activeThreadId) {
    const thread: ThreadMeta = {
      id: activeThreadId,
      title: deriveThreadTitle(text),
      createdAt: now,
      updatedAt: now,
    };
    pendingThreadRef.current = false;
    setThreads((prev) => [thread, ...prev]);
    persistThread(companyId, thread).catch((err) =>
      console.error('[store] persist thread failed', err),
    );
  }
  persistMsg({ id: userMsg.id, role: 'me', text, ts: userMsg.ts });
}
```

Also add `persistMsg` and `activeThreadId` to `sendChat`'s dependency array.

- [ ] **Step 6: Add the thread actions** (place near the other `useCallback` actions):

```ts
const toggleChatHistory = useCallback((open?: boolean) => {
  setChatHistoryOpen((c) => (open === undefined ? !c : open));
}, []);

const newChat = useCallback(() => {
  setActiveThreadId(newId());
  pendingThreadRef.current = true; // created in Firestore on first send
  setChatMessages([]);
  setChatHistoryOpen(false);
}, []);

const openThread = useCallback(
  (id: string) => {
    if (!companyId) return;
    pendingThreadRef.current = false;
    setActiveThreadId(id);
    setChatHistoryOpen(false);
    loadThreadMessages(companyId, id)
      .then((msgs) =>
        setChatMessages(
          msgs.map((m) => ({ id: m.id, role: m.role, text: m.text, ts: m.createdAt })),
        ),
      )
      .catch((err) => console.error('[store] loadThreadMessages failed', err));
  },
  [companyId],
);

const renameThread = useCallback(
  (id: string, title: string) => {
    const clean = title.trim();
    if (!clean) return;
    setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, title: clean } : t)));
    if (companyId)
      updateThreadTitle(companyId, id, clean).catch((err) =>
        console.error('[store] updateThreadTitle failed', err),
      );
  },
  [companyId],
);

const deleteThread = useCallback(
  (id: string) => {
    if (!companyId) return;
    const fallback = activeThreadId === id ? pickFallbackThreadId(threads, id) : null;
    setThreads((prev) => prev.filter((t) => t.id !== id));
    deleteThreadAndMessages(companyId, id).catch((err) =>
      console.error('[store] deleteThreadAndMessages failed', err),
    );
    if (activeThreadId === id) {
      if (fallback) openThread(fallback);
      else newChat();
    }
  },
  [companyId, activeThreadId, threads, openThread, newChat],
);
```

- [ ] **Step 7: Wire hydration.** In the `loadCompanyData(...).then(...)` block (destructure near line 279), add `threads: loadedThreads, activeThreadId: loadedActive` to the destructured object, and after `setChatMessages(chat.map(...))` (line ~285) add:

```ts
setThreads(loadedThreads);
setActiveThreadId(loadedActive);
```

- [ ] **Step 8: Expose in the context interface and provider value.** In the `interface` that declares `chatMessages` / `sendChat` (around line 159–216), add:

```ts
  threads: ThreadMeta[];
  activeThreadId: string | null;
  chatHistoryOpen: boolean;
  newChat: () => void;
  openThread: (id: string) => void;
  renameThread: (id: string, title: string) => void;
  deleteThread: (id: string) => void;
  toggleChatHistory: (open?: boolean) => void;
```

And add the same keys to the object passed to the context provider's `value=` (where `toggleCopilot`, `sendChat`, etc. are listed — lines ~1136/1191).

- [ ] **Step 9: Typecheck + unit tests + build.**

Run: `npx tsc --noEmit && npx vitest run lib/chat/threads.test.ts && npm run build`
Expected: all PASS.

- [ ] **Step 10: Commit.**

```bash
git add lib/store.tsx
git commit -m "feat(chat): store thread state, actions, and threadId message routing"
```

---

## Task 5: Copilot history UI + styles (`components/Copilot.tsx`, `app/globals.css`)

**Files:**

- Modify: `components/Copilot.tsx`
- Modify: `app/globals.css`

**Interfaces:**

- Consumes: `threads`, `activeThreadId`, `chatHistoryOpen`, `newChat`, `openThread`, `renameThread`, `deleteThread`, `toggleChatHistory` from `useApp()`; `sortThreadsByRecent`, `relativeTime` from `@/lib/chat/threads`.

- [ ] **Step 1: Import thread helpers** at the top of `components/Copilot.tsx`:

```ts
import { sortThreadsByRecent, relativeTime } from '@/lib/chat/threads';
```

- [ ] **Step 2: Add a `ThreadList` component** (place above the default-exported `Copilot`):

```tsx
function ThreadList() {
  const { threads, activeThreadId, newChat, openThread, renameThread, deleteThread } = useApp();
  const now = Date.now();
  const rows = sortThreadsByRecent(threads);
  return (
    <div className="cthreads">
      <button className="cthreads-new" onClick={newChat}>
        + New chat
      </button>
      <ul className="cthreads-list">
        {rows.map((t) => (
          <li key={t.id} className={`cthreads-row${t.id === activeThreadId ? ' is-active' : ''}`}>
            <button className="cthreads-open" onClick={() => openThread(t.id)}>
              <span className="cthreads-title">{t.title}</span>
              <span className="cthreads-time">{relativeTime(t.updatedAt, now)}</span>
            </button>
            <button
              className="cthreads-rename"
              title="Rename"
              onClick={() => {
                const next = window.prompt('Rename chat', t.title);
                if (next != null) renameThread(t.id, next);
              }}
            >
              Rename
            </button>
            <button
              className="cthreads-del"
              title="Delete"
              onClick={() => {
                if (window.confirm('Delete this chat?')) deleteThread(t.id);
              }}
            >
              Delete
            </button>
          </li>
        ))}
        {rows.length === 0 && <li className="cthreads-empty">No chats yet.</li>}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Add the History toggle to the panel header.** In `Copilot`, destructure `chatHistoryOpen` and `toggleChatHistory` from `useApp()` (alongside the existing `chatMessages`, `sendChat`, etc. near line 191). Then, in the header block (near the "Collapse chat" button, ~line 234), add a History button:

```tsx
<button
  className="ccopilot-history"
  title={chatHistoryOpen ? 'Back to chat' : 'Chat history'}
  aria-label={chatHistoryOpen ? 'Back to chat' : 'Chat history'}
  onClick={() => toggleChatHistory()}
>
  {chatHistoryOpen ? '‹ Back' : '☰ History'}
</button>
```

- [ ] **Step 4: Render the list when open.** Wrap the existing messages+composer body so that when `chatHistoryOpen` is true, `ThreadList` renders instead. Find the messages container (the `chatMessages.map(...)` region, ~line 255) and the composer; wrap both in `{chatHistoryOpen ? <ThreadList /> : (<>...existing body...</>)}`.

- [ ] **Step 5: Add styles.** Append to `app/globals.css`:

```css
.ccopilot-history {
  font-size: 12px;
  background: transparent;
  border: 1px solid var(--line, rgba(255, 255, 255, 0.14));
  color: inherit;
  border-radius: 8px;
  padding: 4px 8px;
  cursor: pointer;
}
.cthreads {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  overflow-y: auto;
}
.cthreads-new {
  align-self: stretch;
  padding: 10px;
  border-radius: 10px;
  border: 1px dashed var(--line, rgba(255, 255, 255, 0.2));
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-weight: 500;
}
.cthreads-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cthreads-row {
  display: flex;
  align-items: center;
  gap: 6px;
  border-radius: 10px;
  padding: 2px;
}
.cthreads-row.is-active {
  background: var(--glass-hi, rgba(255, 255, 255, 0.06));
}
.cthreads-open {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 8px 10px;
  text-align: left;
}
.cthreads-title {
  font-size: 13.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.cthreads-time {
  font-size: 11px;
  opacity: 0.6;
}
.cthreads-rename,
.cthreads-del {
  font-size: 11px;
  background: transparent;
  border: none;
  color: inherit;
  opacity: 0.55;
  cursor: pointer;
}
.cthreads-rename:hover,
.cthreads-del:hover {
  opacity: 1;
}
.cthreads-empty {
  font-size: 12.5px;
  opacity: 0.6;
  padding: 10px;
}
```

- [ ] **Step 6: Typecheck + build.**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add components/Copilot.tsx app/globals.css
git commit -m "feat(chat): in-panel history list + New chat + rename/delete"
```

---

## Task 6: Behavioral verification on Vercel preview

**Files:** none (verification only).

- [ ] **Step 1: Push the branch and open a draft PR** so Vercel builds a preview.

```bash
git push -u origin feat/chat-history
```

- [ ] **Step 2: On the preview URL, walk the checklist** (sign in as a test company):

  1. Open byte chat → confirm the existing conversation appears (backfilled as one thread).
  2. Click **☰ History** → the panel flips to the list; the existing conversation is one row titled from its first message.
  3. Click **+ New chat** → panel flips back, empty, quick-start suggestions shown.
  4. Send a message → a new row appears in History titled from that message; byte replies stream in.
  5. **Switch** to the other thread → its messages load; switch back → the new thread's messages load.
  6. **Rename** a thread → title updates in the list.
  7. **Reload** the page → the active thread + list are restored (order by recency).
  8. **Delete** the active thread → falls back to the next most-recent (or a fresh New chat if it was the only one).

- [ ] **Step 3: Confirm no console errors** and that the Firestore composite index built (Firestore surfaces a one-click "create index" link on first `loadThreadMessages` query if `firestore.indexes.json` wasn't deployed — deploy indexes or click it).

- [ ] **Step 4: Mark the PR ready** once the checklist passes.

---

## Self-Review

**Spec coverage:** data model (Task 1) ✓ · lazy backfill (Task 3) ✓ · store state/actions (Task 4) ✓ · in-panel flip UI, New chat, rename, delete, relative time (Task 5) ✓ · auto-title (Task 2, used in 3+4) ✓ · reopen = resume (openThread loads messages, Task 4) ✓ · delete fallback (Task 4, pickFallbackThreadId) ✓ · non-goals honored (no card persistence, no AI titles) ✓ · testing: pure logic unit-tested (Task 2), integration via typecheck/build + preview (Task 6) ✓.

**Type consistency:** `ThreadMeta` fields (`id/title/createdAt/updatedAt`) and helper signatures (`deriveThreadTitle`, `sortThreadsByRecent`, `needsBackfill(threadCount, messageCount)`, `pickFallbackThreadId`, `relativeTime(ts, now)`) match across Tasks 2–5. `persistChatMessage` requiring `threadId` is consistently satisfied by the `persistMsg` wrapper (Task 4). `CompanyData.threads/activeThreadId` produced in Task 3 are consumed in Task 4 Step 7.

**Edge cases from spec:** pending thread never sent → no Firestore write (Task 4 Step 5 only writes on send) ✓ · delete active thread fallback ✓. Streaming-during-switch is left to preview QA (not separately guarded in code — acceptable for v1; note if it misbehaves).
