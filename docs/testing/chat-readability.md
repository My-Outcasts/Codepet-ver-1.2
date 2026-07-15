# Testing guide — Is the Codepet chat easy to read?

This guide checks one thing: **the chat with byte (the "Conversation with Codepet" panel)
should be big enough and clear enough to read comfortably — in both light and dark mode.**

You do **not** need to be a developer to run this. It takes about 2 minutes.

---

## What you need

- **Google Chrome** (on Mac or Windows).
- **A Codepet link** — any of them works: a preview link, or the live site. Even the opening
  "Let's go" intro screen is fine. **You do not need to log in.**
- **The probe file** — a short block of text kept in the project at
  `scripts/chat-readability-probe.js`. Open that file and copy everything in it, or ask a
  developer to send you its contents.

## How to run the check (step by step)

1. Open the Codepet link in Chrome.
2. Open Chrome's **Console** (a built-in tool — this is normal, not a hack):
   - **Mac:** press `Cmd` + `Option` + `J`
   - **Windows:** press `Ctrl` + `Shift` + `J`
   - A panel opens with a blinking cursor. That's the Console.
3. **Paste** the entire probe text (from `scripts/chat-readability-probe.js`) into the Console.
4. Press **Enter**.
5. Read the result (next section).

## Reading the result

Look at the first line the Console prints:

- **`✅ ALL PASS`** → the chat text is good. **You're done.** ✅
- **`❌ 2 FAILED`** (or any number) → something is wrong. A small table appears below it.
  Look for the rows marked **`FAIL`** in red. Each row shows what was **expected** versus what
  it actually **found**. **Take a screenshot of that table and send it to a developer.**

That's the whole test. Everything below is optional background.

---

## What each check means, in plain English

The probe runs a handful of checks. You don't need to memorize these — but if a row fails,
this tells you what it was looking at:

| Check   | In plain words                                                                             |
| ------- | ------------------------------------------------------------------------------------------ |
| A1 / A2 | The chat text, and the box where you type, are the correct (larger) size.                  |
| A3 / A4 | The chat text uses the strong, easy-to-read color — not a faded gray.                      |
| A5 / A6 | The text stands out clearly from its background — checked in **both light and dark mode**. |
| B1      | Your own sent messages keep their intended color (a safety check that nothing broke).      |
| B4      | The faint "thinking…" text stays faint on purpose.                                         |
| B3      | Message bubbles stay a sensible width and don't run off the edge.                          |

"A" checks confirm the improvement is there. "B" checks make sure nothing else got broken by
accident.

## Also check with your own eyes

The automated probe can't judge everything. Please also do a quick look-and-feel pass:

1. **Open a real chat with byte** (log in and send a couple of messages). Is the text
   comfortable to read at a glance?
2. **Switch between light and dark mode** (the theme toggle is in Settings / the account menu)
   and look again.

Flag anything that looks **too small, too faded, or where a bubble runs off the edge** of the
panel.

---

## For developers — reference

The probe is a browser-console script (it runs in the page, not Node). It injects hidden
`.bub` / `.composer-in` nodes so the **real deployed `globals.css`** applies, measures both
themes, restores the theme, and cleans up after itself. Nothing is persisted. It targets the
byte copilot chat in `components/Copilot.tsx`, styled by the `.bub` / `.composer-in` rules in
`app/globals.css`.

The readability pass set chat message text and the composer input to **14.5px** on the primary
text color **`--t-1`**, while deliberately keeping the user's own bubble on **`--t-2`**.

### Assertions

| ID  | Assertion                                                         | Expected         |
| --- | ----------------------------------------------------------------- | ---------------- |
| A1  | `.bub` font-size                                                  | `14.5px`         |
| A2  | `.composer-in` font-size                                          | `14.5px`         |
| A3  | `.bub` (byte reply) color                                         | `--t-1`          |
| A4  | `.composer-in` color                                              | `--t-1`          |
| A5  | Contrast, **light**: byte-on-`--surface`, user-on-`--accent-tint` | ≥ 7:1 (WCAG AAA) |
| A6  | Contrast, **dark**: same two combinations                         | ≥ 7:1            |
| B1  | `.bub.me` (user bubble) color unchanged                           | `--t-2`          |
| B4  | `.byte-thinking` placeholder stays faint                          | `--t-3`          |
| B3  | `.bub` max-width (no layout blow-out)                             | `94%`            |

**Contrast** is the WCAG contrast ratio between text and its background; **7:1** is the AAA
threshold for normal text. `--t-1` / `--t-2` / `--t-3` are the theme's primary / secondary /
tertiary text colors.

### Reference values (as of the readability pass)

| Combination                              | Light    | Dark     |
| ---------------------------------------- | -------- | -------- |
| byte reply (`--t-1` on `--surface`)      | 17.1 : 1 | 14.8 : 1 |
| user bubble (`--t-2` on `--accent-tint`) | 11.1 : 1 | 10.4 : 1 |

All four clear WCAG AAA (7:1) with wide margin, so leaving the user bubble on `--t-2` is
intentional.

### Adjusting the baseline

Thresholds are constants at the top of the probe:

- `EXPECT_SIZE` — the expected message/composer font-size in px.
- `MIN_CONTRAST` — the contrast floor. Set to `4.5` to audit against WCAG **AA** instead of AAA.

If the design intentionally changes, update these constants **and** the reference table above
in the same change so this guide stays trustworthy.

### What the probe can't catch

It measures synthetic nodes, so the "with your own eyes" checks above still matter:

- Other surfaces reusing the `.bub` class (guide / coach bubbles) looking cramped.
- Real-world horizontal overflow or wrapping inside the live chat panel.

### Related surfaces (out of scope here)

The rest of the "Conversation with Codepet" experience — threads / **New chat**
(`newChat`, `ThreadList`), the jump-to-latest pill, and the rolling context summary
(`lib/ai/threadSummary.ts`, `/api/summarize-thread`, `maybeSummarizeThread`) — shipped
separately with its own logic-level test coverage. This guide is scoped to text readability
only.
