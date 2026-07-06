# Library — Outcome previews (poster rows)

**Date:** 2026-07-06
**Status:** Approved (design), ready to implement
**Surface:** `components/views/LibraryView.tsx` + `app/globals.css` (+ new `components/library/OutcomePreview.tsx`)

## Goal

Make the Library page show, at a glance, _what each deliverable actually is_ — a visual
preview of the Outcome per card — instead of a plain two-line text snippet. Keep the existing
department grouping, and move the page description under the heading.

## Three changes

1. **Masthead** — the description ("Everything byte has shipped or drafted — approved by you,
   kept in one place.") moves from the top-right into the reading flow directly **under the
   `Library` heading**, above the `12 items · 04 live · 08 draft` index line. `.lib-mast` stops
   being a two-column split; it becomes a single stacked column.

2. **Poster rows** — each item becomes **one horizontal card per row** (full content width):
   - **Left (~300px, fixed):** a purpose-built Outcome preview, tinted by the type's hue
     (reuse `LIB_SKIN`). Separated from the right by a hairline.
   - **Right (flex):** type tag (`LIB_TAG`, colored via `LIB_TC`) → title → a 2-line outcome
     description (existing `descOf`) → a bottom meta row with the `Live`/`Draft` pip; `open →`
     fades in on hover.
   - Whole card is clickable → `viewItem(x)` (unchanged). Hover lifts the card.
   - Cards stay grouped under the current department headers (`byDept`, canonical `DEPTS`
     order), in the app's existing `.lib-group` / `.lib-ghead` structure.

3. **Categorized by department** — already implemented; retained as-is.

## OutcomePreview component

New `components/library/OutcomePreview.tsx` exporting `<OutcomePreview item={x} />`. It switches
on `item.type` and renders a small, purpose-built preview from the item's **real structured
data**, with a graceful fallback when a seed item carries only `out` text.

| type           | preview                                                      | reads                               |
| -------------- | ------------------------------------------------------------ | ----------------------------------- |
| `site`         | browser chrome (dots + url bar, headline + 2 bars)           | structural                          |
| `build`        | browser chrome + green "✓ shipped & verified" ribbon         | structural                          |
| `screens`      | two stacked phone frames                                     | structural                          |
| `plan`         | numbered steps 1·2·3 (count from `plan.steps`, cap 3)        | `plan.steps`                        |
| `sheet`        | mini table / number band                                     | structural                          |
| `post`         | social card: byte avatar + real post body                    | `post.variants[0].body`             |
| `email`        | subject line + body lines + "N-email sequence"               | `email.subject`, `email.seq.length` |
| `calendar`     | 2-week day grid, marked days = posts                         | `calendar.weeks[].items`            |
| `legal`        | document page + section title, "review" flag if `legal.flag` | `legal.docTitle`, `legal.flag`      |
| `doc` / `prep` | document page (title + text lines)                           | `doc.title` or `out`                |
| `dms`          | chat bubbles with a real message snippet                     | `dms[0].msg`                        |
| `checklist`    | up to 4 checkbox rows with real done state                   | `checklist[].done`                  |

**Fallback:** if the expected structured field is missing/empty, render the generic "document
page" preview (title + lines seeded from `out`). No preview ever throws on missing data.

**Preview is presentational only** — no iframes, no interactivity, no data fetching. It renders
static shapes + short real strings, so it's cheap to mount many at once and can't break the
list. All hues come from existing CSS tokens (`--accent`, `--blue`, `--clay`, `--violet`,
`--gold` families) already used by `LIB_SKIN`.

## CSS

Add a `.lib-*` poster-row block to `app/globals.css`:

- `.lib-mast` → single column (drop the flex split); `.lib-say` sits under `h1`.
- `.lib-grid` (per dept) → `display:flex; flex-direction:column; gap`.
- `.lib-tile` → horizontal flex (`min-height:150px`); `.lt-prev` left panel (300px, tinted,
  right hairline); `.lt-info` right column with tag/title/desc/meta.
- Per-type preview classes (`.op-*`) scoped under `.lt-prev`.
- Theme-aware via existing tokens; respects `prefers-reduced-motion` for the hover lift.

## Out of scope (YAGNI)

- Real scaled `ArtifactViewer` renders / iframe thumbnails (explicitly rejected in favor of
  purpose-built previews).
- Persisting checkbox/hover state from the preview (previews are read-only; the modal owns
  interaction).
- Changing the filter chips, counts, empty state, or `viewItem` behavior.

## Verify

On the Vercel PR preview (prod build; per project convention — not `next dev`): Library shows
one poster row per item, correct preview per type, description under the heading, department
grouping intact, click opens the same viewer, light + dark both legible.
