# Department Foundations — Design

**Date:** 2026-07-03
**Status:** Approved design, pending implementation plan
**Branch:** `feat/department-foundations` (off `origin/main`)

## Problem

Codepet presents 8 departments as if each were a specialist, but the tasks byte
generates come from a **single one-line role hint** per department
(`/api/scaffold`'s `role` string, e.g. _"Marketing: positioning, launch, content,
and audience"_) plus the founder's stage as a bare label. `/api/run-task` gets even
less — just the department **name** (`deptName`). So byte improvises 8 functions
from thin hints: department-shaped, but a generalist's guesses, not an operator's
craft — and not reliably the right work _for this stage_.

The rich `need`/`byte` text in `lib/data.ts` is hardcoded to _Codepet's own_
company (the seed), not a reusable per-department foundation.

## Goal

Give each of the 8 departments a **solid, reusable foundation** — real expertise +
stage-aware focus — that the existing generation prompts read from, so the tasks
byte already produces (and the deliverables it drafts) come from an operator's brain
tuned to the founder's stage.

**No new feature surface.** One new static data module + richer input to two existing
prompts. No UI, no new flows, no runtime playbook generation.

## Confirmed model (from the codebase)

- **8 fixed departments** (keys): `eng`, `design`, `mkt`, `sales`, `support`, `fin`,
  `ops`, `legal`.
- **6 stages** (`OB_STAGES`): `Just an idea` → `Prototype` → `Private beta` →
  `Public beta` → `Launched` → `Growing`.
- **Consumers today:** `/api/scaffold` (generates the per-department tasks — the main
  target; has the dept keys + stage), `/api/run-task` (drafts a deliverable; gets
  `deptName` only), `/api/next-step` (prioritizes; gets `deptName` only — left alone).

## The foundation data

New module `lib/ai/departments.ts`:

```ts
import { OB_STAGES } from '../data'; // the 6 stage labels

export interface DepartmentFoundation {
  /** 2–3 sentences: what this function owns and what "winning" looks like. */
  mandate: string;
  /** Core competencies this function works from. */
  skills: string[];
  /** One focus line for each of the 6 OB_STAGES — what to prioritize at that stage. */
  stageFocus: Record<string, string>;
  /** The founder mistakes this function guards against — sharpens byte's judgment. */
  antipatterns: string[];
}

/** Keyed by the 8 fixed department keys. */
export const DEPARTMENT_FOUNDATIONS: Record<string, DepartmentFoundation> = {
  /* eng, design, mkt, sales, support, fin, ops, legal — authored content (below) */
};
```

Every `stageFocus` must have **exactly the 6 `OB_STAGES` keys**, all non-empty — the
data holds all 48 stage cells, but prompts inject only the founder's current slice.

### Two pure composer helpers (also in the module)

- `departmentBlock(k: string, stage: string): string` — for **scaffold**. Composes:
  mandate + skills + **only the current-stage `stageFocus` line** + anti-patterns,
  into a compact prompt block. Unknown key or stage → a minimal safe block (never
  throws), so generation can't break.
- `departmentBrief(k: string): string` — for **run-task**. Composes mandate + skills
  only (the task already carries the stage-specific ask). Unknown key → empty/safe.

## Threading

### `/api/scaffold/route.ts`

Replace the `role` one-liner per department in the prompt's department list with
`departmentBlock(k, stage)`. The generation call, schema, and everything else are
unchanged — byte simply sees each department's real mandate/skills/current-stage
focus/anti-patterns instead of a thin role, and writes its 2–4 tasks from that.

### `/api/run-task/route.ts`

Accept a new optional `deptKey` field on the request body (validated like the
existing `deptName`). When present, inject `departmentBrief(deptKey)` into the prompt
next to the existing `Department: ${deptName}` line, so byte drafts the deliverable
as that function's operator. Absent `deptKey` → unchanged behavior (backward
compatible).

### Client passthrough

The caller of run-task (`lib/ai/runTask.ts` → `runByteTask`, invoked from the store
and `ArtifactModal`) has the department object with `.k`. Thread `deptKey` through the
`runByteTask` params → the request body. Additive optional field; existing callers
that don't pass it still work.

## Content requirements (the real deliverable)

For each of the 8 departments, authored to a consistent bar:

- **mandate:** what the function owns for _a founder building a product_ (product-
  and stage-agnostic — the generation supplies the specific product); concrete, no
  hype, no emoji; matches byte's warm plain voice.
- **skills:** 4–7 named competencies, specific enough to steer (e.g. Marketing:
  positioning, messaging, channel strategy, launch sequencing, content, lifecycle).
- **stageFocus (×6):** for each stage, the 1–2 highest-leverage things this function
  should push _at that stage_ — the "right thing right now." Early stages skew
  validation/product; later stages skew launch/growth/scale. Distinct per stage.
- **antipatterns:** 2–4 common founder mistakes this function guards against
  (e.g. Marketing: "polishing a brand before anyone wants the product").

### Authoring is collaborative, department-by-department

The content is the point of this work. Implementation drafts **one department's full
foundation at a time**; the founder reviews and corrects it before the next. Only
after all 8 are approved does the plumbing (composers + threading + tests) finalize.
This is a human-in-the-loop authoring loop, not an autonomous batch.

## Testing

- **Completeness test (the important one):** all 8 department keys present; each
  `stageFocus` has exactly the 6 `OB_STAGES` keys (no missing/extra), every field
  non-empty — a missing stage cell or department can't silently ship.
- **Composer tests (pure):** `departmentBlock` includes the mandate/skills/current
  stage line/anti-patterns and _only_ the current stage's focus (not all 6);
  `departmentBrief` includes mandate + skills; both degrade to a safe non-throwing
  value on an unknown key/stage.
- **Manual:** re-plan the same company at two different stages → the generated tasks
  visibly reflect the department's craft and shift with the stage; run one task per a
  couple of departments → the deliverable reads like that specialist wrote it.

## Scope, risk, out-of-scope

- **In scope:** the `lib/ai/departments.ts` module (types + data + composers),
  threading into `/api/scaffold` and `/api/run-task`, the `deptKey` passthrough, tests.
- **Out of scope (YAGNI):** `/api/next-step` (pure prioritization — no benefit); any
  UI; runtime/AI-generated foundations; linking foundations to the Environment
  toolkit; per-department separate generation calls.
- **Not Giang's:** `/api/scaffold` and `/api/run-task` are core AI generation, not the
  Build Coach (`/api/track*`, `/api/build-plan`, toolkit/hooks) — in bounds.
- **Risk:** the concurrent session actively edits `/api/run-task`. Work in an isolated
  worktree off `origin/main`; all changes additive; merge carefully before the PR.
