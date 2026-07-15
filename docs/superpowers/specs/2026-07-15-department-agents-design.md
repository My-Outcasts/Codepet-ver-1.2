# Department agents — a specialist brain per department

**Date:** 2026-07-15
**Status:** As built (revised after discovering existing infrastructure)
**Branch:** `feat/department-agents` → `develop`

## What this actually is

The goal: each pet reasons like a genuine **domain specialist** for its department, not
just speaking in its voice. Companions (`lib/companions.ts`) are voice-only; the specialist
_expertise_ is a separate concern.

**Key discovery during implementation:** that expertise layer **already exists** —
`lib/ai/departments.ts` (`DEPARTMENT_FOUNDATIONS`, shipped in PR #65 "Department
foundations: real expertise + stage-aware focus per department"). Each of the 8 departments
already has a curated `mandate`, `skills`, per-stage `stageFocus`, and `antipatterns`, and it
is **already wired into every generation surface**:

| Surface                    | Expertise today  | Via                                                                      |
| -------------------------- | ---------------- | ------------------------------------------------------------------------ |
| `run-task` (deliverables)  | already injected | `buildTaskPrompt` → `departmentBrief(deptKey)`                           |
| `task-help` (how-tos)      | already injected | `buildTaskHelpPrompt` → `departmentBrief(deptKey)`                       |
| `scaffold` (company setup) | already injected | `departmentBlock(deptKey, stage)`                                        |
| **`chat` (the copilot)**   | **gap**          | only had the founder's dept _status_ (`deptSummary`), not the foundation |

So an original plan to build a _new_ `lib/departments.ts` with a parallel set of briefs was
**dropped** — it would have duplicated (worse, non-stage-aware) the existing curated system.
The real, small gap was the **chat copilot**, which spoke in the right voice but without the
department's expertise foundation behind it.

## Changes shipped

1. **Wire the existing foundation into chat.** Append the existing
   `departmentBrief(focusDeptKey)` (mandate + core skills — the same block run-task and
   task-help read) into the chat copilot's system prompt, placed before the persona (voice)
   override so voice stays the final instruction. When no department is in focus, the brief is
   `''` and general chat is unchanged (fail-open).
2. **Tolerant signature.** `departmentBrief(k?: string | null)` — chat's `focusDeptKey` is
   `string | undefined`; a null/undefined/unknown key returns `''`. Runtime behavior was
   already fail-open; this widens the type so every caller can pass an optional key.
3. **Legal output disclaimer.** `DELIVERABLE_INSTRUCTIONS.legal` now requires the generated
   legal document to close with a note that it is general information, not legal advice, and
   that a qualified professional should review anything binding. (The foundation already
   covered the _strategy_ of "know when to bring in a lawyer"; this adds the missing
   _output-facing_ disclaimer.)

## Non-goals / rejected

- **No new `lib/departments.ts`.** Reuse the existing `lib/ai/departments.ts`.
- **No change to run-task / task-help / scaffold** — they already inject the brief. Adding it
  again would double it (the mistake that surfaced the existing system).
- **No `qualityBar` field.** Each foundation's `mandate` already states "what winning looks
  like," so a separate definition-of-done would duplicate curated content.
- No deliverable schema/structure changes; no new AI calls; no autonomous agents.

## Files touched

- `lib/ai/departments.ts` — widen `departmentBrief` signature to `(k?: string | null)`; doc note.
- `app/api/chat/route.ts` — inject `departmentBrief(focusDeptKey)` into the system prompt.
- `lib/ai/deliverableSchemas.ts` — add the not-legal-advice disclaimer to the legal instruction.
- `lib/ai/departments.test.ts` — assert the tolerant null/undefined case.
- `lib/ai/deliverableSchemas.test.ts` — assert the legal disclaimer is present.

## Testing

- `departmentBrief` returns `''` for unknown / `''` / `null` / `undefined` (fail-open); the
  existing suite already covers mandate+skills content and unknown keys.
- `DELIVERABLE_INSTRUCTIONS.legal` contains the "not legal advice" disclaimer.
- Full suite green (713 passing), tsc clean (pre-existing `firestore.rules.test` drift aside),
  eslint clean on touched files.
- Behavior verified on the Vercel preview: a Finance/Legal chat reasons with department
  expertise; a general (no-focus) chat is unchanged; a Legal deliverable carries the disclaimer.

## Rollout

Prompt-layer only, fail-open, no schema/data-model change → no migration. PR to `develop`.
