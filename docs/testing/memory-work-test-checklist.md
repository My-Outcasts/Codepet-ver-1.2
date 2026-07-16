# Test checklist — memory & chat work (Jul 2026)

Plain-language test cases for the chat/memory work shipped this cycle. Written so a
non-technical tester or teammate can run each one without reading the code.

- **Where to test:** the `develop` build (all items below are merged to `develop`, **not** on
  prod/`main` yet).
- **How to use:** work top to bottom. For each item, do the steps and check the **Pass**
  box only if the result matches. If it doesn't, note what you saw.

---

## 1. The "Ask byte" button shows the Codepet C logo

**What changed:** the floating chat button (bottom-right, shown when the chat panel is
closed) now shows the round Codepet "C" logo — no byte character, no "Ask byte" text.

**Steps:**

1. Close the byte chat panel.
2. Look at the bottom-right corner.
3. Click the button.

- [ ] **Pass:** a round C-logo button (about coin-sized) is shown, and clicking it opens the chat.

---

## 2. Byte no longer repeats "Ooh, let's build something!"

**What changed:** tapping a "Let's build it →" suggestion more than once used to make byte
repeat the same "Ooh, let's build something!" greeting. It should now appear only once.

**Steps:**

1. Get byte to offer a build (a **"Let's build it →"** button appears in the chat).
2. Tap it.
3. Try tapping it again.

- [ ] **Pass:** the "Ooh, let's build something!" message appears **once**, never stacked or repeated.

---

## 3. Your roadmap & plans respect decisions you've made

**What changed:** when byte regenerates your roadmap, next step, or departments, it now
takes into account the decisions you've locked in — so it won't contradict them.

**Steps:**

1. In chat, tell byte a clear decision, e.g. **"Our pricing is $29/month flat, no free tier."**
2. Regenerate the roadmap (or "re-plan my stage").

- [ ] **Pass:** the new plan reflects that decision (no free-tier task, pricing stays consistent)
      and does not re-plan work you've already finished.

---

## 4. Byte remembers earlier parts of a long conversation

**What changed:** byte used to only "see" your last ~20 messages, so in a long chat it would
forget things you said early on. It now keeps a running summary of the older part of the
conversation, so earlier context survives.

**Steps:**

1. Early in a chat, tell byte a small, memorable detail that is **not** a business decision —
   e.g. **"My cat is named Waffles."**
2. Keep chatting about other things for **~15 more back-and-forth messages**, so the cat
   message scrolls well out of view.
3. Ask: **"What's my cat's name?"**

- [ ] **Pass:** byte still answers **"Waffles."**

### 4a. Still works after a page reload

**Steps:**

1. Do steps 1–2 above.
2. **Refresh the page** partway through the long chat, reopen the same chat, and keep going.
3. Ask again: **"What's my cat's name?"**

- [ ] **Pass:** byte still remembers **"Waffles"**, and long chats keep working after the reload.

### 4b. Deleting a thread keeps it deleted

**Steps:**

1. Right after a long message (one that triggers the summary), **delete that chat thread**.
2. **Refresh the page.**

- [ ] **Pass:** the deleted thread stays gone — it does **not** reappear after the refresh.

> **Expected behavior (not a bug):** deleting a chat also removes that conversation's
> remembered context (its rolling summary). This is intended — only durable
> decisions/facts (which byte promotes to project memory) survive a delete; general
> conversation context that never became a decision lives only in the thread and goes
> with it. Do **not** file this as a memory-loss bug.

---

## Status reference

| #       | Item                                       | PR   | State             |
| ------- | ------------------------------------------ | ---- | ----------------- |
| 1       | "Ask byte" button → C logo                 | #136 | merged to develop |
| 2       | No duplicate "Ooh, let's build something!" | #142 | merged to develop |
| 3       | Roadmap/plans respect your decisions       | #143 | merged to develop |
| 4       | Byte remembers earlier in long chats       | #145 | merged to develop |
| 4a / 4b | Reload + delete-thread hardening           | #147 | merged to develop |

> Reminder: everything is on **`develop`**. Promote `develop → main` to put it in front of
> real users on prod.
