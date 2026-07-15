# Testing guide — Chat readability (Conversation with Codepet)

Audit guide for the readability of the **byte copilot chat** (`components/Copilot.tsx`,
styled via the `.bub` / `.composer-in` rules in `app/globals.css`).

The readability pass set chat message text and the composer input to **14.5px** on the
primary text color **`--t-1`**, while keeping the user's own bubble on **`--t-2`** by design.
This guide is how you confirm that's still true — and hasn't regressed — on any deployment.

## TL;DR

1. Open any Codepet page in Chrome (preview or prod — the splash screen is fine, no login needed).
2. DevTools → Console.
3. Paste the entire contents of [`scripts/chat-readability-probe.js`](../../scripts/chat-readability-probe.js) and press Enter.
4. Expect **`✅ ALL PASS`** and a green `console.table`.

The probe is a browser-console script (it runs in the page, not Node). It injects hidden
`.bub` / `.composer-in` nodes so the **real deployed `globals.css`** applies, measures both
light and dark themes, restores the theme, and cleans up after itself. Nothing is persisted.

## What it checks

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

`A1–A6` verify the fix; `B1/B3/B4` are regression guards that flag if a future change
accidentally reverts the size, re-mutes byte text, or disturbs the bubble layout.

### Reference values (as of the readability pass)

| Combination                              | Light    | Dark     |
| ---------------------------------------- | -------- | -------- |
| byte reply (`--t-1` on `--surface`)      | 17.1 : 1 | 14.8 : 1 |
| user bubble (`--t-2` on `--accent-tint`) | 11.1 : 1 | 10.4 : 1 |

All four clear WCAG AAA (7:1) with wide margin, so the user bubble was intentionally left on
`--t-2` — bumping it to `--t-1` is unnecessary.

## Reading the output

The probe returns an object and logs a table:

```js
{ verdict: "ALL PASS", failed: [], contrast: { light: {...}, dark: {...} }, results: [...] }
```

- `verdict: "ALL PASS"` → the deployed CSS matches the baseline.
- `verdict: "N FAILED"` → `failed` lists the offending assertion IDs; find them in the table
  (red `FAIL` rows) to see the `got` vs `expected` values.

Typical regressions and what turns red:

- Message size reverted to 13px → **A1** (and **A2** if the composer too).
- byte text pushed back onto the muted `--t-2` → **A3**, and likely **A5/A6** drop below 7:1.
- A theme's `--surface` / `--accent-tint` retuned darker/lighter → **A5** or **A6**.

## Adjusting the baseline

The thresholds are constants at the top of the probe:

- `EXPECT_SIZE` — the expected message/composer font-size in px.
- `MIN_CONTRAST` — the contrast floor. Set to `4.5` to audit against WCAG **AA** instead of AAA.

If the design intentionally changes (e.g. a new default size), update these constants **and**
the reference table above in the same change so the guide stays trustworthy.

## Limits — what the probe can't catch

The probe measures synthetic nodes, so two Section-B concerns still need a human glance at the
real, logged-in chat:

- **B2** — other surfaces that reuse the `.bub` class (guide / coach bubbles) looking cramped
  at the larger size.
- Real-world horizontal overflow or wrapping breaks inside the actual chat panel.

For those, open the app, enter a chat with a few messages, and eyeball it in both themes
(the theme toggle lives in the account menu / settings).

## Related surfaces (out of scope here)

The rest of the "Conversation with Codepet" experience — threads / **New chat**
(`newChat`, `ThreadList`), the jump-to-latest pill, and the rolling context summary
(`lib/ai/threadSummary.ts`, `/api/summarize-thread`, `maybeSummarizeThread`) — shipped
separately and has its own logic-level test coverage. This guide is scoped to text
readability only.
