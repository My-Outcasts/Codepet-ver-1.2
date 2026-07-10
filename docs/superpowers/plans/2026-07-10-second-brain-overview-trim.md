# Second Brain Overview Trim — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In `SECOND_BRAIN_V2` mode, trim the Overview screen down to a full-width galaxy plus one compact value strip, moving chat to an on-demand floating launcher.

**Architecture:** Pure front-end edits to two React components (`OverviewView.tsx`, `AppRoot.tsx`), all inline-styled per the existing pattern. No new data, no backend, no new deps. The galaxy renderer and non-v2 layout are untouched. Chat access shifts from a permanent left rail to the app-shell's existing floating "Ask" launcher + right dock, which are currently suppressed in Second Brain mode.

**Tech Stack:** Next.js (React, TypeScript), inline styles, `app/globals.css` for the shell grid. No test runner for these components — verification is typecheck + lint + build + a visual run.

## Global Constraints

- Change **only** the `SECOND_BRAIN_V2 === true` behavior. The non-v2 Overview layout must render exactly as before.
- `SECOND_BRAIN_V2 = process.env.NEXT_PUBLIC_SECOND_BRAIN_V2 === '1'` (const at `components/views/OverviewView.tsx:65`). To see v2 while testing, `.env.local` must have `NEXT_PUBLIC_SECOND_BRAIN_V2=1`.
- Follow the existing inline-style idiom (no CSS modules, no styled-components).
- Value-strip copy is Vietnamese-friendly plain text; keep it to ≤ 2 lines.
- Metric rule: a number shows only when `> 0`; if all three metrics are 0, omit the whole metrics line.
- Keep the build clean — remove any state/handler/import left unused after a deletion (the repo runs `eslint .` and `tsc --noEmit`).

## File Structure

- **Modify** `components/views/OverviewView.tsx` — remove v2 peripheral UI (left chat rail, right `SecondBrainPanel`, "Ask your Second Brain" search box, bottom legend, "What changed" timeline panel + its Timeline toggle), widen the galaxy wrapper to fill, add the compact value strip, prune now-dead state/handlers/imports.
- **Modify** `components/AppRoot.tsx` — stop suppressing the docked `<Copilot />` and the floating "Ask" launcher in `sbMode`; stop force-collapsing the dock, so chat is reachable on demand.

No files created or deleted. `components/views/overview/SecondBrainPanel.tsx` stays on disk (kept for reference) but is no longer imported.

---

### Task 1: Strip the v2 peripheral UI and widen the galaxy

**Files:**
- Modify: `components/views/OverviewView.tsx`

**Interfaces:**
- Consumes: existing locals `SECOND_BRAIN_V2` (const, `:65`), `events`, `wrapRef`.
- Produces: a v2 layout where the galaxy wrapper fills the section and the only overlay left is the title block (title + subtitle + empty-state backfill) and the `examplePlan` banner. Later tasks add the value strip (Task 2) and restore chat (Task 3).

- [ ] **Step 1: Remove the left chat rail (`<Copilot inline />`)**

Delete this whole block (currently near `:1451`–`:1467`):

```tsx
      {/* Second Brain v2: left chat rail (reuses byte's chat inline). The app-shell's right
          dock is suppressed in this mode (AppRoot), so this is the only chat instance. */}
      {SECOND_BRAIN_V2 && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            width: 320,
            zIndex: 7,
            pointerEvents: 'auto',
          }}
        >
          <Copilot inline />
        </div>
      )}
```

- [ ] **Step 2: Widen the galaxy wrapper to fill the section**

The map wrapper is the `<div ref={wrapRef} ...>` right after the block you just removed (currently `:1468`–`:1475`). Replace its style so v2 fills the whole section:

```tsx
      <div
        ref={wrapRef}
        style={{ position: 'absolute', inset: 0 }}
      >
```

(This drops the `SECOND_BRAIN_V2 ? {left:320, right:326} : {inset:0}` ternary — both modes now use `inset: 0`. Non-v2 already used `inset: 0`, so it is unchanged.)

- [ ] **Step 3: Remove the right `SecondBrainPanel` block**

Delete this whole block (currently `:1375`–`:1396`):

```tsx
      {SECOND_BRAIN_V2 && (
        <div
          style={{
            position: 'absolute',
            top: 58,
            right: 26,
            bottom: 26,
            width: 300,
            maxWidth: '38vw',
            zIndex: 6,
            pointerEvents: 'auto',
          }}
        >
          <SecondBrainPanel
            events={events}
            nextStep={nextStep}
            tracking={tracking}
            companionId={companionId}
            onTopic={(k) => flyTo(`dept:${k}`)}
          />
        </div>
      )}
```

- [ ] **Step 4: Remove the "Ask your Second Brain" search box**

Delete the entire `{SECOND_BRAIN_V2 && ( ... )}` block that starts with the comment `{/* Ask your Second Brain (P2 recall)...` (currently `:1113`–`:1199`) — the `<form>` with the input + "Ask" button and the `{askHits !== null && ( ... )}` hits list. Leave the empty-state backfill block above it (`:1081`–`:1112`) and the `examplePlan` banner below it (`:1202`–`:1238`) intact.

- [ ] **Step 5: Remove the Timeline toggle row (keep Sync history)**

In the block currently at `:1239`–`:1280`, remove **only** the first button (the Timeline toggle) and keep the "Sync history" button. Result:

```tsx
        {SECOND_BRAIN_V2 && events.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', gap: 8, pointerEvents: 'auto' }}>
            <button
              onClick={async () => {
                if (backfilling) return;
                setBackfilling(true);
                const r = await runSecondBrainBackfill();
                if (r.backfilled > 0) window.location.reload();
                else setBackfilling(false);
              }}
              title="Pull all your deliverables, decisions and completed tasks into the graph"
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: '5px 12px',
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(16,14,28,0.7)',
                color: 'rgba(245,243,255,.7)',
                cursor: backfilling ? 'default' : 'pointer',
                opacity: backfilling ? 0.6 : 1,
              }}
            >
              {backfilling ? 'Syncing…' : 'Sync history'}
            </button>
          </div>
        )}
```

(Note the added `&& events.length > 0` — a brand-new account uses the empty-state "Load my past work" button instead, so this pill is hidden until there is history.)

- [ ] **Step 6: Remove the "What changed" timeline panel**

Delete the entire `{SECOND_BRAIN_V2 && timelineOpen && ( ... )}` block (currently `:1283`–`:1373`) — the absolute-positioned panel with the "What changed" heading, the filter pills, and the event rows.

- [ ] **Step 7: Remove the v2 legend and fix the bottom block**

The bottom block is currently `:1399`–`:1449` (`<div>` with `left: SECOND_BRAIN_V2 ? 346 : 26` holding the `<Legend />` dots). Since v2 no longer shows a legend, gate the whole block to non-v2 and simplify its offset:

```tsx
      {!SECOND_BRAIN_V2 && (
        <div
          style={{
            position: 'absolute',
            bottom: 20,
            left: 26,
            zIndex: 5,
            display: 'flex',
            gap: 16,
            flexWrap: 'wrap',
            fontSize: 11.5,
            color: 'rgba(245,243,255,.7)',
            pointerEvents: 'none',
          }}
        >
          <Legend dot="#F4F1FF" label="Project" />
          <Legend dot="#8B5CF6" label="byte does" />
          <Legend dot="#FDB022" label="Needs approval" />
          <Legend dot="#3B82F6" label="Needs you" />
          <Legend dot="#34D399" label="Done" />
          {introPhase === 'done' && (
            <button
              type="button"
              onClick={() => setIntroPhase('intro')}
              style={{
                pointerEvents: 'auto',
                fontFamily: 'inherit',
                fontSize: 11.5,
                color: 'rgba(245,243,255,.55)',
                background: 'transparent',
                border: 'none',
                borderLeft: '1px solid rgba(245,243,255,.15)',
                paddingLeft: 16,
                cursor: 'pointer',
              }}
            >
              ? how to read this map
            </button>
          )}
        </div>
      )}
```

- [ ] **Step 8: Fix the title block offsets**

The title block is currently `:1060`–`:1070`ish (`<div>` with `left: SECOND_BRAIN_V2 ? 346 : 26` and `right: SECOND_BRAIN_V2 ? 326 : 26`). Both offsets no longer need to dodge side columns — set them to `26`:

```tsx
      <div
        style={{
          position: 'absolute',
          top: 58,
          left: 26,
          right: 26,
          maxWidth: 640,
          zIndex: 5,
          pointerEvents: 'none',
        }}
      >
```

- [ ] **Step 9: Prune now-dead state, handlers, and imports**

After Steps 1–8, these symbols are no longer referenced. Remove each:
- State (currently `:305`–`:310`): `askQuery`/`setAskQuery`, `askHits`/`setAskHits`, `asking`/`setAsking`, `timelineOpen`/`setTimelineOpen`, `timelineFilter`/`setTimelineFilter`. Keep `backfilling`/`setBackfilling` (Sync + empty-state still use it).
- Handlers: `runAsk` (`:822`), `openHit` (`:831`), `openEvent` (`:839`). (Confirm no other caller with a grep before deleting — see Step 10.)
- Imports: from `@/lib/ai/recallClient` drop `askSecondBrain` and `type RecallHit`, keep `runSecondBrainBackfill` (`:22`); remove the whole `@/lib/overview/timeline` import line `filterEvents, relativeTime, type TimelineFilter` (`:23`); remove the `SecondBrainPanel` import (`:24`); remove the `Copilot` import (`:25`) **only if** no other `<Copilot` usage remains in this file (grep to confirm — the left rail was the only one).

- [ ] **Step 10: Verify nothing else references the removed symbols**

Run:

```bash
cd /Users/williamdominich/Documents/Murror/Codepet-ver-1.2
grep -n "askQuery\|askHits\|\basking\b\|runAsk\|openHit\|openEvent\|timelineOpen\|timelineFilter\|SecondBrainPanel\|filterEvents\|relativeTime\|TimelineFilter\|askSecondBrain\|RecallHit\|Copilot" components/views/OverviewView.tsx
```

Expected: no matches (empty output). If a symbol still appears, it has another use — leave that symbol's declaration in place.

- [ ] **Step 11: Typecheck and lint**

Run:

```bash
npm run typecheck && npm run lint
```

Expected: both pass with no errors about `OverviewView.tsx` (no unused vars, no missing symbols).

- [ ] **Step 12: Commit**

```bash
git add components/views/OverviewView.tsx
git commit -m "feat(second-brain): strip v2 peripherals — full-width galaxy, no side panels

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add the compact value strip

**Files:**
- Modify: `components/views/OverviewView.tsx`

**Interfaces:**
- Consumes: locals already in scope — `events`, `tracking` (has `hoursSaved: number`), `nextStep` (`NextStep | null`, has `taskTitle: string` and `deptK: string`), `flyTo(id: string)` (called elsewhere as `flyTo(\`dept:${k}\`)`).
- Consumes: `ledgerCounts(events)` from `@/lib/overview/secondBrainStats` — returns `{ deliverables, decisions, milestones, tasks }` (all numbers). This is the same helper `SecondBrainPanel` used.
- Produces: a value strip rendered inside the title block, below the subtitle, only when `events.length > 0`.

- [ ] **Step 1: Import `ledgerCounts`**

Add near the other `@/lib/overview/...` imports at the top of `OverviewView.tsx`:

```tsx
import { ledgerCounts } from '@/lib/overview/secondBrainStats';
```

- [ ] **Step 2: Compute the metrics inside the component**

Just after the component's existing derived values (anywhere before the `return (`), add:

```tsx
  // Second Brain value strip: three "what you've made" numbers + the next move.
  const sbCounts = SECOND_BRAIN_V2 ? ledgerCounts(events) : null;
  const sbMetrics: [string, number][] = sbCounts
    ? [
        ['deliverables', sbCounts.deliverables],
        ['decisions', sbCounts.decisions],
        ['h saved', Math.round(tracking.hoursSaved)],
      ]
    : [];
  const sbMetricsShown = sbMetrics.filter(([, v]) => v > 0);
  const nextStepDept = nextStep ? DEPTS.find((d) => d.k === nextStep.deptK)?.name : null;
```

(`DEPTS` is already imported in this file — it is used by the galaxy build. Confirm with a grep; if absent, add `import { DEPTS } from '@/lib/data';`.)

- [ ] **Step 3: Render the strip in the title block**

Inside the title block, immediately after the subtitle `<div>` (the one containing the "Everything you and byte have made…" text) and before the empty-state block, insert:

```tsx
        {SECOND_BRAIN_V2 && events.length > 0 && (
          <div style={{ marginTop: 12, pointerEvents: 'auto' }}>
            {sbMetricsShown.length > 0 && (
              <div style={{ fontSize: 13, color: 'rgba(245,243,255,.75)' }}>
                {sbMetricsShown.map(([label, v], i) => (
                  <span key={label}>
                    {i > 0 && <span style={{ opacity: 0.4 }}>{'  ·  '}</span>}
                    <span style={{ color: '#7DE3FF', fontWeight: 700 }}>
                      {label === 'h saved' ? `~${v}h` : v}
                    </span>{' '}
                    {label === 'h saved' ? 'saved' : label}
                  </span>
                ))}
              </div>
            )}
            {nextStep && (
              <button
                onClick={() => flyTo(`dept:${nextStep.deptK}`)}
                style={{
                  display: 'block',
                  marginTop: 8,
                  textAlign: 'left',
                  fontSize: 12.5,
                  fontFamily: 'inherit',
                  color: '#F5F3FF',
                  background: 'rgba(125,227,255,0.08)',
                  border: '1px solid rgba(125,227,255,0.3)',
                  borderRadius: 9,
                  padding: '7px 11px',
                  cursor: 'pointer',
                }}
              >
                <span style={{ color: '#7DE3FF', fontWeight: 700 }}>▸ Việc tiếp theo:</span>{' '}
                {nextStep.taskTitle}
                {nextStepDept && (
                  <span style={{ color: 'rgba(245,243,255,.45)' }}>{`  ·  ${nextStepDept}`}</span>
                )}
              </button>
            )}
          </div>
        )}
```

- [ ] **Step 4: Trim the subtitle to one calm line**

Change the v2 subtitle string (in the `<div>` above the strip) from the long "…ask it anything, or click a star to open it." to:

```tsx
            ? 'Mọi thứ bạn và byte đã tạo, kết nối lại — bấm một ngôi sao để mở.'
```

(Leave the non-v2 subtitle branch unchanged.)

- [ ] **Step 5: Typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: both pass.

- [ ] **Step 6: Visual check**

```bash
NEXT_PUBLIC_SECOND_BRAIN_V2=1 npm run dev
```

Open the app on the Overview screen with a company that has events. Expected: galaxy fills the screen; top-left shows title, one-line subtitle, a value line like `12 deliverables · 8 decisions · ~40h saved`, and a "▸ Việc tiếp theo: …" button that flies the camera to that department when clicked. No right panel, no search box, no legend, no timeline.

- [ ] **Step 7: Commit**

```bash
git add components/views/OverviewView.tsx
git commit -m "feat(second-brain): compact value strip — 3 core metrics + next move

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Restore on-demand chat via the floating launcher

**Files:**
- Modify: `components/AppRoot.tsx`

**Interfaces:**
- Consumes: existing `copilotCollapsed` (defaults to `true` in the store), `toggleCopilot`, and the `.cop-open`/`.cop-collapsed` CSS in `app/globals.css` (unchanged).
- Produces: in Second Brain mode the galaxy stays full-width (dock collapsed by default), a floating "Ask {companion}" button appears bottom-right, and clicking it opens the right dock chat.

- [ ] **Step 1: Stop force-collapsing the dock in sbMode**

In the shell `<div className=...>` (currently `:96`), remove the `|| sbMode` so the dock follows the user's toggle:

```tsx
      <div
        className={`shell${copilotCollapsed ? ' cop-collapsed' : ''}${sideCollapsed ? ' side-collapsed' : ''}`}
      >
```

- [ ] **Step 2: Always render the docked Copilot**

Change `:107` from `{!sbMode && <Copilot />}` to:

```tsx
        <Copilot />
```

- [ ] **Step 3: Always render the floating "Ask" launcher**

Remove the `!sbMode && (` guard around the `.cop-open` button (currently `:109`–`:119`) so it always renders:

```tsx
      {/* The floating "Ask" launcher opens byte's chat on demand. */}
      <button
        className={`cop-open${copilotCollapsed ? ' show' : ''}`}
        aria-label={`Open ${c.name} chat`}
        onClick={() => toggleCopilot(false)}
      >
        <Companion id={companionId} size="s28" />
        Ask {c.name}
      </button>
```

- [ ] **Step 4: Remove the now-unused `sbMode`**

`sbMode` (defined `:63`–`:64`) has no remaining references. Delete its declaration and the two-line comment above it. Confirm:

```bash
grep -n "sbMode" components/AppRoot.tsx
```

Expected: no matches.

- [ ] **Step 5: Typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: both pass (no unused `sbMode`).

- [ ] **Step 6: Visual check**

```bash
NEXT_PUBLIC_SECOND_BRAIN_V2=1 npm run dev
```

On the Overview screen: galaxy is full-width, a bottom-right "Ask {companion}" button is visible. Click it — the right dock chat opens and the galaxy makes room; close it — the galaxy returns to full width. Navigate to another view and back — no double chat, no console errors.

- [ ] **Step 7: Commit**

```bash
git add components/AppRoot.tsx
git commit -m "feat(second-brain): chat on demand — floating launcher instead of a fixed rail

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Run the full gate: `npm run typecheck && npm run lint && npm run build` — all pass.
- [ ] With `NEXT_PUBLIC_SECOND_BRAIN_V2=1`: galaxy full-width; only title + one-line subtitle + value strip (+ "Sync history" pill when there is history, or "Load my past work" when empty); chat reachable via the floating launcher; no search box, no right panel, no legend, no timeline.
- [ ] With `NEXT_PUBLIC_SECOND_BRAIN_V2` unset/`0`: the Overview screen looks and behaves exactly as before (legend, "how to read this map", normal chat dock).

## Self-Review Notes

- **Spec coverage:** galaxy full-width (T1 S2), remove chat rail (T1 S1)/panel (T1 S3)/search (T1 S4)/legend (T1 S7)/timeline (T1 S5–S6), value strip with Deliverables·Decisions·~h saved + next step (T2), chat via floating launcher (T3), empty-state backfill preserved (untouched in T1 S4; Sync pill gated in T1 S5). All covered.
- **Placeholder scan:** none — every edit shows concrete code.
- **Type consistency:** `ledgerCounts` returns `{deliverables, decisions, milestones, tasks}` (used in T2); `nextStep.taskTitle`/`deptK` and `flyTo(\`dept:${k}\`)` match existing usage in `SecondBrainPanel`/`OverviewView`.
