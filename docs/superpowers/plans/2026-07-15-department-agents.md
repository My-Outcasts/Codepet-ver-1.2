# Department Agents — Implementation Plan (superseded / as-built)

> **Note:** The original plan here proposed a new `lib/departments.ts` module with a
> parallel set of per-department briefs. During implementation we discovered the
> expertise layer **already exists** (`lib/ai/departments.ts`, PR #65) and is already
> wired into run-task, task-help, and scaffold. That plan was **dropped** to avoid
> duplicating curated infrastructure. See the revised design:
> `docs/superpowers/specs/2026-07-15-department-agents-design.md`.

## As built

The only real gap was the **chat copilot**, plus a missing legal output disclaimer.

1. **`app/api/chat/route.ts`** — inject the existing `departmentBrief(focusDeptKey)` into the
   copilot system prompt (before the persona/voice override). Fails open to `''` when no
   department is in focus, so general chat is unchanged.
2. **`lib/ai/departments.ts`** — widen `departmentBrief` to `(k?: string | null)` so chat's
   optional `focusDeptKey` type-checks; runtime was already fail-open.
3. **`lib/ai/deliverableSchemas.ts`** — the legal deliverable instruction now requires a
   closing "general information, not legal advice — have a professional review anything
   binding" note.
4. **Tests** — `lib/ai/departments.test.ts` asserts the tolerant null/undefined case;
   `lib/ai/deliverableSchemas.test.ts` asserts the legal disclaimer.

Verification: full suite green (713), tsc + eslint clean on touched files, behavior confirmed
on the Vercel preview (Finance/Legal chat reasons with expertise; general chat unchanged;
legal deliverable carries the disclaimer).
