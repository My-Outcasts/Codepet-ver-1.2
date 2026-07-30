# Broaden grounding — feed decisions (+ shipped work) to the lighter AI routes

**Date:** 2026-07-14
**Status:** implemented (PR → develop)
**Context:** follow-up from the Context & Memory Architecture trace (Notion: "Context & Memory Architecture" under CODEPET PRD — 1.2).

## Problem

Only `chat`, `run-task`, and `task-help` ground on the full **project model**
(`composeProjectModel` = brief narrative + locked-in `decisions` + shipped-work digest).
The lighter generation routes ground on the **brief alone** (`briefToContext`):

| Route              | Grounded on (before) |
| ------------------ | -------------------- |
| `next-step`        | brief only           |
| `roadmap`          | brief only           |
| `scaffold`         | brief only           |
| `project-analysis` | brief only           |

Consequence: these routes can contradict decisions the founder has locked in — a
regenerated roadmap can re-open a settled pricing/positioning call, or re-plan work
that's already shipped, because the generation never sees `decisions` or the library.

## Change

Add a shared server helper and route it into the three routes where decisions matter.

### `lib/ai/serverGrounding.ts` (new)

`loadGrounding(uid, idToken, { withShipped?, fallbackBrief? }) → { context, brief, hasBrief }`

- Loads `brief` + `decisions` via `loadServerCompany`, optionally `library` via
  `loadServerLibrary`, and composes them with the existing `composeProjectModel`.
- Returns the raw `brief` (for stage extraction) and `hasBrief` (a brief-presence flag)
  so callers that must not invent a company from decisions alone gate on `hasBrief`,
  **not** on `context` (which can be non-empty from decisions with no brief).
- Fail-open: underlying loaders return empty on any error → thinner grounding, never a throw.

### Route wiring

| Route       | Grounding now                          | Notes                                                                                                                                                                                             |
| ----------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roadmap`   | brief + decisions + **shipped digest** | `withShipped: true`; `noBrief` guard now keys on `hasBrief`; stage still read off raw `brief`.                                                                                                    |
| `next-step` | brief + decisions                      | Cheapest win; runs on `LIGHT_MODEL`. Falls back to `CODEPET_CONTEXT` when empty (unchanged).                                                                                                      |
| `scaffold`  | brief + decisions                      | Keeps its **enriched in-memory brief** (from `enrichBrief`) for narrative + stage; only appends `composeDecisions(decisions)`. No `hasBrief` change — its existing `!context` guard is preserved. |

### Out of scope — `project-analysis`

Deliberately left brief-only. It's the **one-time first-run** read of the brief; at that
point `decisions` and `library` are empty, so there's nothing to add. Revisit only if it
ever re-runs later in the lifecycle.

## Design notes / trade-offs

- **Reuse over duplication:** all four grounded routes now flow through the same
  `composeProjectModel`; `next-step`/`roadmap` share `loadGrounding`, `scaffold` composes
  decisions directly because it must keep its enriched brief.
- **Extra reads:** `roadmap` adds one library read; `scaffold` adds one company read for
  decisions. Both routes are infrequent (regenerate-on-demand), so cost is negligible.
- **Token cost:** decisions are capped at `MAX_DECISIONS = 30` and the shipped digest is
  bounded (titles-only, 16 items) — modest, and cache-friendly on the routes that cache.
- **Guard safety:** `hasBrief` prevents the "company invented from decisions with no brief"
  failure mode that a naive `!context` guard would have introduced.

## Verification

- Unit: `composeProjectModel` path already covered; full suite **711 pass**, typecheck clean.
- Manual (preview): lock in a decision via chat (`remember_fact`), then regenerate the
  roadmap / re-plan the stage → the output should respect that decision and not re-plan
  shipped work. Confirm `next-step` still picks sensibly and never re-opens a decided item.

## Rollout

Single PR to `develop`. No schema change, no migration, no flag — purely additive grounding.
Fail-open means the worst case (a load error) degrades to today's brief-only behavior.
