# Department Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each of the 8 departments a reusable foundation (mandate + skills + 6-stage focus + anti-patterns) that `/api/scaffold` and `/api/run-task` read from, so byte's generated tasks and deliverables come from an operator's brain tuned to the founder's stage.

**Architecture:** One new static module `lib/ai/departments.ts` holds the typed `DEPARTMENT_FOUNDATIONS` data plus two pure composer helpers that emit compact prompt blocks (feeding only the current-stage slice). `/api/scaffold` swaps its one-line `role` for `departmentBlock(k, stage)`; `/api/run-task` injects `departmentBrief(k)` behind a new optional `deptKey` threaded from the client. No UI, no runtime generation.

**Tech Stack:** Next.js 16 / TypeScript, Vitest. Server routes are Node runtime.

## Global Constraints

- Work only in the worktree `/private/tmp/claude-501/-Users-monatruong/d31cb161-d475-4451-86b0-aea1ff23a43b/scratchpad/wt-deptfound` on branch `feat/department-foundations`. Never touch the main checkout.
- **Do not modify Giang's Build Coach files** (BuildCoachView / InstallView / SummaryView, tracking, toolkit/hooks, `/api/track*`, `/api/build-plan`). `/api/scaffold` and `/api/run-task` are core AI generation and ARE in scope.
- The `stageFocus` keys are exactly the 6 `OB_STAGES` strings, verbatim: `Just an idea`, `Prototype`, `Private beta`, `Public beta`, `Launched`, `Growing`.
- The 8 department keys are exactly: `eng`, `design`, `mkt`, `sales`, `support`, `fin`, `ops`, `legal`.
- Foundation content is the **approved, verbatim** text embedded in Task 1 — do not paraphrase, shorten, or "improve" it.
- Copy tone: warm, plain, specific; no hype, no emoji, no decorative arrows.
- All changes additive/backward-compatible (`run-task` without `deptKey` behaves as today).
- Run tools via local binaries: `./node_modules/.bin/{tsc,eslint,prettier,vitest}`.
- Gate green before each commit: `tsc --noEmit` (ignore pre-existing firestore.rules.test.ts errors), `eslint <changed files>` (exit 0), `prettier --check`, `vitest run`.
- Commit after each task. Do not push or open a PR until the user asks.

---

### Task 1: The `lib/ai/departments.ts` module (data + composers, TDD)

**Files:**
- Create: `lib/ai/departments.ts`
- Test: `lib/ai/departments.test.ts`

**Interfaces:**
- Produces:
  - `interface DepartmentFoundation { mandate: string; skills: string[]; stageFocus: Record<string, string>; antipatterns: string[]; }`
  - `const DEPARTMENT_FOUNDATIONS: Record<string, DepartmentFoundation>` (8 keys)
  - `departmentBlock(k: string, stage: string): string` — mandate + skills + ONLY the current-stage focus line + anti-patterns; `''` for an unknown key; omits the focus line for an unknown stage.
  - `departmentBrief(k: string): string` — mandate + skills only; `''` for an unknown key.

- [ ] **Step 1: Write the failing tests**

Create `lib/ai/departments.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { OB_STAGES } from '../data';
import {
  DEPARTMENT_FOUNDATIONS,
  departmentBlock,
  departmentBrief,
} from './departments';

const KEYS = ['eng', 'design', 'mkt', 'sales', 'support', 'fin', 'ops', 'legal'];

describe('DEPARTMENT_FOUNDATIONS completeness', () => {
  it('has exactly the 8 department keys', () => {
    expect(Object.keys(DEPARTMENT_FOUNDATIONS).sort()).toEqual([...KEYS].sort());
  });
  it('every department has a non-empty mandate, skills, and anti-patterns', () => {
    for (const k of KEYS) {
      const f = DEPARTMENT_FOUNDATIONS[k];
      expect(f.mandate.trim().length, `${k} mandate`).toBeGreaterThan(0);
      expect(f.skills.length, `${k} skills`).toBeGreaterThan(0);
      expect(f.skills.every((s) => s.trim().length > 0), `${k} skills non-empty`).toBe(true);
      expect(f.antipatterns.length, `${k} antipatterns`).toBeGreaterThan(0);
    }
  });
  it('every stageFocus has exactly the 6 OB_STAGES keys, all non-empty', () => {
    for (const k of KEYS) {
      const focus = DEPARTMENT_FOUNDATIONS[k].stageFocus;
      expect(Object.keys(focus).sort(), `${k} stage keys`).toEqual([...OB_STAGES].sort());
      for (const s of OB_STAGES) {
        expect(focus[s].trim().length, `${k}/${s}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('departmentBlock', () => {
  it('includes mandate, skills, the current-stage focus, and anti-patterns', () => {
    const b = departmentBlock('mkt', 'Private beta');
    expect(b).toContain(DEPARTMENT_FOUNDATIONS.mkt.mandate);
    expect(b).toContain(DEPARTMENT_FOUNDATIONS.mkt.skills[0]);
    expect(b).toContain(DEPARTMENT_FOUNDATIONS.mkt.stageFocus['Private beta']);
    expect(b).toContain(DEPARTMENT_FOUNDATIONS.mkt.antipatterns[0]);
  });
  it('includes ONLY the current stage focus, not other stages', () => {
    const b = departmentBlock('mkt', 'Private beta');
    expect(b).not.toContain(DEPARTMENT_FOUNDATIONS.mkt.stageFocus['Growing']);
  });
  it('unknown key -> empty string', () => {
    expect(departmentBlock('nope', 'Private beta')).toBe('');
  });
  it('unknown stage -> block without a focus line (never throws)', () => {
    const b = departmentBlock('eng', 'Nonsense');
    expect(b).toContain(DEPARTMENT_FOUNDATIONS.eng.mandate);
    expect(b.toLowerCase()).not.toContain('focus at the');
  });
});

describe('departmentBrief', () => {
  it('includes mandate + skills only (no stage focus, no anti-patterns)', () => {
    const b = departmentBrief('eng');
    expect(b).toContain(DEPARTMENT_FOUNDATIONS.eng.mandate);
    expect(b).toContain(DEPARTMENT_FOUNDATIONS.eng.skills[0]);
    expect(b).not.toContain(DEPARTMENT_FOUNDATIONS.eng.stageFocus['Just an idea']);
    expect(b).not.toContain(DEPARTMENT_FOUNDATIONS.eng.antipatterns[0]);
  });
  it('unknown key -> empty string', () => {
    expect(departmentBrief('nope')).toBe('');
  });
});
```

- [ ] **Step 2: Run the tests — verify they fail**

Run: `./node_modules/.bin/vitest run lib/ai/departments.test.ts`
Expected: FAIL — `Cannot find module './departments'`.

- [ ] **Step 3: Create `lib/ai/departments.ts`**

Transcribe exactly (the content is approved — do not alter wording):

```ts
// Reusable per-department foundations: real expertise + stage-aware focus that the
// generation prompts read from, so byte's tasks (/api/scaffold) and deliverables
// (/api/run-task) come from an operator's brain tuned to the founder's stage — not a
// one-line role hint. Static, curated data (no runtime generation). Keys match the 8
// fixed departments; stageFocus keys match OB_STAGES.

export interface DepartmentFoundation {
  /** 2–3 sentences: what this function owns and what "winning" looks like. */
  mandate: string;
  /** Core competencies this function works from. */
  skills: string[];
  /** One focus line per OB_STAGES value — what to prioritize at that stage. */
  stageFocus: Record<string, string>;
  /** The founder mistakes this function guards against — sharpens byte's judgment. */
  antipatterns: string[];
}

export const DEPARTMENT_FOUNDATIONS: Record<string, DepartmentFoundation> = {
  eng: {
    mandate:
      'Engineering builds the product itself — turning the founder’s idea into something real people can use, then keeping it stable enough to trust as usage grows. Winning is shipping the smallest thing that proves the core value, then hardening only what real usage demands — never gold-plating ahead of need.',
    skills: [
      'scoping an MVP to its riskiest assumption',
      'system and data-model design',
      'shipping cadence and cutting scope',
      'instrumentation and error monitoring',
      'technical-debt triage',
      'performance and reliability under load',
    ],
    stageFocus: {
      'Just an idea':
        'Prove the single riskiest technical assumption with the crudest possible spike: is the core thing even buildable? Don’t build anything you’d keep.',
      Prototype:
        'Build the one core flow end-to-end, ugly but real, so it can go in front of a person. Instrument just enough to see if it works.',
      'Private beta':
        'Make that core flow reliable for a handful of hand-held users; add enough logging and error capture to learn fast. Fix what breaks, ignore what doesn’t.',
      'Public beta':
        'Harden the paths real users actually hit; kill the crash and data-loss bugs; make signup-to-value work without you in the room.',
      Launched:
        'The boring reliability work — monitoring, backups, on-call basics — so growth doesn’t break trust. Pay down the debt that’s now slowing you.',
      Growing:
        'Scale the parts actually straining (not the ones you fear), and build the second and third features that deepen retention — sequenced by evidence, not wishlist.',
    },
    antipatterns: [
      'building infrastructure for scale you don’t have yet',
      'polishing code quality before the product is validated',
      'adding features instead of fixing the core flow that isn’t landing',
      'rewrites when a targeted fix would do',
    ],
  },
  design: {
    mandate:
      'Design owns how the product feels to use — the path from first touch to value, and whether it’s clear enough that people succeed without help. Winning is a first-run where a new user reaches the core value fast and understands what happened, so they come back.',
    skills: [
      'user flows and information architecture',
      'first-run and onboarding design',
      'interaction and UI craft',
      'usability testing on real users',
      'microcopy for clarity',
      'reducing steps-to-value',
    ],
    stageFocus: {
      'Just an idea':
        'Sketch the core flow as rough wireframes to pressure-test whether the idea is even usable. Paper-level, no polish.',
      Prototype:
        'Design the one core flow so a real person can attempt it unaided; watch where they get stuck.',
      'Private beta':
        'Fix the friction the first testers actually hit — the confusing step, the dead end — before adding anything. Nail the "aha" moment.',
      'Public beta':
        'Tighten first-run so a stranger reaches value without hand-holding; make empty and error states teach.',
      Launched:
        'Raise the craft bar on the paths that convert and retain; make the product feel trustworthy where it counts.',
      Growing:
        'Design the second-order journeys — habit, depth, re-engagement — and clear the accumulated rough edges slowing power users.',
    },
    antipatterns: [
      'polishing visuals before the flow works',
      'designing screens no one has tried to use',
      'adding onboarding steps instead of removing them',
      'a beautiful empty state with no path to value',
    ],
  },
  mkt: {
    mandate:
      'Marketing owns positioning and demand — making the right people understand why this is for them, and building an audience that’s ready when you ship. Winning is a message that resonates and a growing pool of people who want in.',
    skills: [
      'positioning and messaging',
      'audience and channel strategy',
      'launch sequencing',
      'teaching-in-public and content',
      'lifecycle and email',
      'copywriting in the founder’s voice',
    ],
    stageFocus: {
      'Just an idea':
        'Write the one-line positioning and the "who + what problem," sharp enough to test in conversations. No brand, no logo.',
      Prototype:
        'Find where your first users hang out and start showing the thing; harvest the words they use so the message is theirs, not yours.',
      'Private beta':
        'Build the waitlist or interest loop and a small teaching-in-public thread; confirm the message pulls the right people.',
      'Public beta':
        'Sequence the launch (assets, channels, timing) and warm the audience; turn early users into proof.',
      Launched:
        'Run the launch, then convert attention into a repeatable acquisition loop — the one or two channels that actually work; start lifecycle to activate signups.',
      Growing:
        'Double down on channels with traction, systematize content, and build referral and word-of-mouth so growth compounds.',
    },
    antipatterns: [
      'polishing a brand before anyone wants the product',
      'launching to an audience you haven’t built',
      'chasing every channel instead of the one that works',
      'talking features instead of the problem',
    ],
  },
  sales: {
    mandate:
      'Sales owns landing the first real customers — the direct, unscalable work of getting specific people to say yes. Winning early isn’t a pipeline; it’s a handful of real users who prove someone wants this enough to act.',
    skills: [
      'prospecting and target-list building',
      'personalized outreach, not broadcast',
      'discovery — hearing the real need',
      'objection handling',
      'asking for the commitment',
      'early pricing conversations',
    ],
    stageFocus: {
      'Just an idea':
        'List 20–30 specific people who have the problem; start conversations to validate the pain, not to sell.',
      Prototype:
        'Get the rough thing in front of those people one-to-one; ask for a small commitment (a trial, a call, a pre-order) to test real intent.',
      'Private beta':
        'Hand-recruit the first cohort personally — a per-person ask, not a broadcast — and stay close to hear what makes them stick or bounce.',
      'Public beta':
        'Turn warm interest into first paying or committed users; find the repeatable reason people say yes.',
      Launched:
        'Convert launch attention into customers with a clear path to yes; document what closes so it repeats.',
      Growing:
        'Build a light repeatable motion for the segments that convert; know who to chase and who to ignore.',
    },
    antipatterns: [
      'broadcasting instead of talking to people one at a time',
      'pitching before understanding the need',
      'building a CRM before you have customers',
      'selling to everyone instead of the few who desperately need it',
    ],
  },
  support: {
    mandate:
      'Support owns user success after they’re in — turning confusion into confidence, and what breaks into what you learn. Winning is users who get unstuck fast and a founder who hears every problem while there are still few enough to fix.',
    skills: [
      'responsive help and triage',
      'writing help docs and FAQs',
      'turning tickets into product insight',
      'onboarding assistance',
      'expectation management',
      'closing the loop with users',
    ],
    stageFocus: {
      'Just an idea':
        'Nothing formal yet, but decide how the first testers reach you (a DM, an email) so no early signal is lost.',
      Prototype:
        'Be the support: hand-hold every tester personally and log every point of confusion — your richest product data.',
      'Private beta':
        'Set up a fast, personal help channel; triage what breaks and feed recurring issues straight to Engineering and Design.',
      'Public beta':
        'Write the first help docs and FAQ for the questions you keep answering; start deflecting the repeats so you scale past one-to-one.',
      Launched:
        'Stand up a real support flow (inbox, canned replies, a response bar) so growth doesn’t drown you; keep mining tickets for fixes.',
      Growing:
        'Systematize self-serve (docs, in-app help), watch for churn signals in support, and turn resolved users into advocates.',
    },
    antipatterns: [
      'automating support before you understand the questions',
      'treating tickets as chores instead of product signal',
      'building a help center no one reads',
      'going silent on users who hit a wall',
    ],
  },
  fin: {
    mandate:
      'Finance owns whether the business math works — pricing, the model of money in versus out, and enough runway and proof to keep going. Winning is a price the market will actually pay and a clear-eyed view of what has to be true for this to be a business.',
    skills: [
      'pricing and packaging',
      'financial modeling (unit economics, runway)',
      'willingness-to-pay testing',
      'burn and runway tracking',
      'fundraising narrative',
      'scenario and sensitivity analysis',
    ],
    stageFocus: {
      'Just an idea':
        'One page of rough business logic: who pays, roughly how much, and what must be true for the numbers to work. Assumptions, not spreadsheets.',
      Prototype:
        'Frame the pricing hypothesis and how you’ll test willingness to pay; don’t set a price in stone.',
      'Private beta':
        'Test willingness to pay for real — a price conversation, a pre-order, a fake door — before committing; build a simple model off what you learn.',
      'Public beta':
        'Lock a launch price and packaging you can defend; model the funnel (signups → paid → churn) so you know the levers.',
      Launched:
        'Track real unit economics and burn; know your runway and the one or two numbers that decide whether this works.',
      Growing:
        'Tighten pricing with real data, model growth scenarios, and — if raising — build the numbers narrative behind the story.',
    },
    antipatterns: [
      'a detailed five-year model before your first customer',
      'guessing at a price instead of testing it',
      'ignoring runway until it’s urgent',
      'optimizing costs that don’t matter yet',
    ],
  },
  ops: {
    mandate:
      'Operations owns the machinery that lets everything else run — the tools, process, and logistics behind shipping and running the product. Winning is a founder who isn’t the bottleneck, with just enough process to move fast without dropping balls.',
    skills: [
      'tooling and infrastructure setup',
      'process design, only where it pays',
      'launch logistics and checklists',
      'vendor and account setup',
      'light automation',
      'tracking what matters',
    ],
    stageFocus: {
      'Just an idea':
        'Almost nothing — resist process. Set up only the couple of accounts or tools you genuinely need to start building.',
      Prototype:
        'Stand up the minimum plumbing (repo, hosting, the one or two services the core flow needs); keep it boring.',
      'Private beta':
        'Machinery to run a small closed beta — invites and access, a way to track who’s in and what’s happening — so you learn without chaos.',
      'Public beta':
        'Build the launch-readiness checklist and the pipelines a bigger influx needs; remove the manual steps that break at volume.',
      Launched:
        'Put the basics on rails — deploys, backups, a runbook — so the founder isn’t hand-cranking everything during growth.',
      Growing:
        'Automate the repetitive load, tighten the processes now straining, and set up light metrics that keep the company legible.',
    },
    antipatterns: [
      'adding process before there’s anything to run',
      'automating a workflow you’ve done twice',
      'setting up tools you don’t need yet',
      'becoming the bottleneck by hoarding manual steps',
    ],
  },
  legal: {
    mandate:
      'Legal owns covering the essentials so the product can ship and grow without avoidable risk — the policies, terms, and compliance the business actually needs. Winning is the legal minimum handled cleanly at the right time: not ignored, not gold-plated.',
    skills: [
      'privacy policy and terms drafting',
      'data-handling and compliance basics',
      'contracts and agreements',
      'IP and ownership hygiene',
      'domain-specific regulatory awareness',
      'knowing when to bring in a real lawyer',
    ],
    stageFocus: {
      'Just an idea':
        'Nothing yet — just note anything legally sensitive about the idea (data, a regulated space) to handle later. Don’t lawyer a prototype.',
      Prototype:
        'Still minimal; just be mindful of how you handle any real user data you touch while testing.',
      'Private beta':
        'Draft the basics to put it in front of outside users — a simple privacy policy and terms — framed to how the product actually handles data.',
      'Public beta':
        'Firm up privacy and terms for a public audience; check the obvious domain-specific requirements before more people rely on it.',
      Launched:
        'Make sure the shipping essentials are covered — policies live, data handling honest, compliance basics for your space — and have a lawyer glance at anything load-bearing.',
      Growing:
        'Tighten contracts and compliance as stakes rise (customers, data, money), and bring in real counsel for what now warrants it.',
    },
    antipatterns: [
      'over-lawyering before you have users',
      'shipping with no privacy policy while handling real data',
      'copy-pasting terms that don’t match the product',
      'treating "a lawyer should see this" as optional on the load-bearing stuff',
    ],
  },
};

/** Scaffold block: mandate + skills + ONLY the current-stage focus + anti-patterns. */
export function departmentBlock(k: string, stage: string): string {
  const f = DEPARTMENT_FOUNDATIONS[k];
  if (!f) return '';
  const lines = [`Mandate: ${f.mandate}`, `Core skills: ${f.skills.join(', ')}.`];
  const focus = f.stageFocus[stage];
  if (focus) lines.push(`Focus at the "${stage}" stage: ${focus}`);
  lines.push(`Avoid: ${f.antipatterns.join('; ')}.`);
  return lines.join('\n');
}

/** Run-task block: mandate + skills only (the task already carries the stage ask). */
export function departmentBrief(k: string): string {
  const f = DEPARTMENT_FOUNDATIONS[k];
  if (!f) return '';
  return `Mandate: ${f.mandate}\nCore skills: ${f.skills.join(', ')}.`;
}
```

- [ ] **Step 4: Run the tests — verify they pass + suite green**

Run: `./node_modules/.bin/vitest run lib/ai/departments.test.ts` → PASS.
Then `./node_modules/.bin/tsc --noEmit` (ignore firestore.rules.test.ts), `./node_modules/.bin/eslint lib/ai/departments.ts lib/ai/departments.test.ts` (exit 0), `./node_modules/.bin/prettier --write` those two then `--check`.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/departments.ts lib/ai/departments.test.ts
git commit -m "feat(departments): per-department foundations (mandate + skills + 6-stage focus + anti-patterns) + composers"
```

---

### Task 2: Thread `departmentBlock` into `/api/scaffold`

**Files:**
- Modify: `app/api/scaffold/route.ts`

**Interfaces:**
- Consumes: `departmentBlock(k, stage)` from `@/lib/ai/departments` (Task 1).

- [ ] **Step 1: Import the composer**

At the top of `app/api/scaffold/route.ts`, add:

```ts
import { departmentBlock } from '@/lib/ai/departments';
```

- [ ] **Step 2: Feed each department's foundation block into the prompt**

Find the `deptList` construction (it currently maps the `DEPARTMENTS` array using `d.role`, roughly: `const deptList = DEPARTMENTS.map((d) => \`- ${d.k} (${d.name}): ${d.role}\`).join('\n');`). Replace it with a version that emits each department's full foundation block for the founder's `stage` (the `stage` variable already exists in scope, resolved above the prompt):

```ts
  const deptList = DEPARTMENTS.map(
    (d) => `- ${d.k} (${d.name}):\n${departmentBlock(d.k, stage)}`,
  ).join('\n\n');
```

Leave the `DEPARTMENTS` array, the schema, the generation call, and everything else unchanged. (The `role` field is now unused by the prompt; leaving it in the array is harmless — do not remove it in this task to keep the diff minimal.)

- [ ] **Step 3: Gate**

```bash
./node_modules/.bin/tsc --noEmit    # ignore firestore.rules.test.ts
./node_modules/.bin/eslint app/api/scaffold/route.ts
./node_modules/.bin/prettier --write app/api/scaffold/route.ts && ./node_modules/.bin/prettier --check app/api/scaffold/route.ts
./node_modules/.bin/vitest run
```
Expected: clean/pass. (Prompt-only change; no unit test — verified manually in Task 4.)

- [ ] **Step 4: Commit**

```bash
git add app/api/scaffold/route.ts
git commit -m "feat(departments): scaffold generates tasks from each department's stage-aware foundation"
```

---

### Task 3: Thread `departmentBrief` into `/api/run-task` + `deptKey` passthrough

**Files:**
- Modify: `app/api/run-task/route.ts`
- Modify: `lib/ai/runTask.ts` (`RunArgs`)
- Modify: `lib/store.tsx` (two `runByteTask` calls)
- Modify: `components/artifact/ArtifactModal.tsx` (two `runByteTask` calls)

**Interfaces:**
- Consumes: `departmentBrief(k)` from `@/lib/ai/departments` (Task 1).
- Produces: an optional `deptKey?: string` on `RunArgs` and the run-task request; when present, the deliverable prompt includes the department brief.

- [ ] **Step 1: Add `deptKey` to the client `RunArgs`**

In `lib/ai/runTask.ts`, find `export interface RunArgs {` (it has `deptName?: string;`) and add:

```ts
  deptKey?: string;
```

`runByteTask` sends `JSON.stringify(args)`, so no other client change is needed to transmit it.

- [ ] **Step 2: Pass `deptKey` from the four call sites**

Each caller has the department object `d` (with `.k`). Add `deptKey: d.k,` alongside the existing `deptName` in each `runByteTask({ ... })` call:
- `lib/store.tsx` — the call in `runTaskInChat` (~line 862) and the call in `reviseTaskInChat` (~line 906). Both have `d` in scope.
- `components/artifact/ArtifactModal.tsx` — the produce call (~line 320) and the revise call (~line 351). Use the modal's department object key (confirm its variable name — `dept`/`d`; use `<that>.k`).

If any of these four call sites does not have a department object with `.k` in scope, STOP and report rather than guessing.

- [ ] **Step 3: Parse + inject `deptKey` in `/api/run-task/route.ts`**

Find the `fields` type/object (it declares `deptName?: string` and parses `deptName: typeof body.deptName === 'string' ? body.deptName : undefined`). Add the parallel `deptKey`:
- In the `fields` type block: `deptKey?: string;`
- In the parse block: `deptKey: typeof body.deptKey === 'string' ? body.deptKey : undefined,`

Then find where the prompt is built from `fields` (the `buildPrompt` function; it currently emits `deptName ? \`Department: ${deptName}\` : null` among the prompt lines). Import the composer at the top:

```ts
import { departmentBrief } from '@/lib/ai/departments';
```

And, in `buildPrompt`, right after the `Department: ${deptName}` line, add the brief when a `deptKey` resolves to a foundation (destructure `deptKey` from `fields` alongside the others):

```ts
    deptKey && departmentBrief(deptKey) ? departmentBrief(deptKey) : null,
```

(The surrounding array is filtered for null/falsy before joining — match the existing pattern; `departmentBrief` returns `''` for an unknown key, so a bad `deptKey` adds nothing.)

- [ ] **Step 4: Gate**

```bash
./node_modules/.bin/tsc --noEmit    # ignore firestore.rules.test.ts
./node_modules/.bin/eslint app/api/run-task/route.ts lib/ai/runTask.ts lib/store.tsx components/artifact/ArtifactModal.tsx
./node_modules/.bin/prettier --write app/api/run-task/route.ts lib/ai/runTask.ts lib/store.tsx components/artifact/ArtifactModal.tsx && ./node_modules/.bin/prettier --check app/api/run-task/route.ts lib/ai/runTask.ts lib/store.tsx components/artifact/ArtifactModal.tsx
./node_modules/.bin/vitest run
```
Expected: all clean/pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/run-task/route.ts lib/ai/runTask.ts lib/store.tsx components/artifact/ArtifactModal.tsx
git commit -m "feat(departments): run-task drafts deliverables from the department's foundation (deptKey)"
```

---

### Task 4: Full gate + manual verification

**Files:** none.

- [ ] **Step 1: Full gate from the worktree**

```bash
cd <worktree>
./node_modules/.bin/prettier --check .
./node_modules/.bin/tsc --noEmit          # ignore ONLY pre-existing firestore.rules.test.ts errors
./node_modules/.bin/eslint .              # exit 0
./node_modules/.bin/vitest run            # all pass
```

- [ ] **Step 2: Manual proof (localhost, signed in)**

Copy `.env.local` from the main checkout into the worktree, start `PORT=3013 ./node_modules/.bin/next dev --webpack`, hand the URL to the user to sign in. Then:
1. On a fresh test company, complete onboarding (or "Re-plan for my stage") at an **early** stage (e.g. Prototype) → the generated department tasks should read as validation/product-first and specific to the craft (e.g. Sales = "talk to 20–30 people," not "build a pipeline").
2. Change stage (advance) or re-plan at a **later** stage (e.g. Launched) → the same departments' tasks visibly shift toward launch/scale.
3. Run one task in a couple of departments (e.g. Marketing, Finance) → the deliverable reads like that specialist wrote it.

- [ ] **Step 3: Stop the dev server**

```bash
lsof -ti:3013 | xargs kill -9 2>/dev/null || true
```

- [ ] **Step 4: Report** the verified behavior + gate result. Do not push or open a PR until the user asks.

---

## Self-Review

**Spec coverage:**
- `lib/ai/departments.ts` module (types + data + composers) → Task 1. ✓
- All 8 departments' verbatim content, 6-stage focus, anti-patterns → Task 1 (embedded). ✓
- Completeness test (8 keys, 6 stage keys each, non-empty) + composer tests → Task 1. ✓
- `departmentBlock` feeds only current-stage slice → Task 1 (composer + test). ✓
- Thread into `/api/scaffold` → Task 2. ✓
- Thread into `/api/run-task` + `deptKey` passthrough (client + 4 call sites) → Task 3. ✓
- Backward compatible (no `deptKey` = unchanged) → Task 3 (optional field, `departmentBrief` '' fallback). ✓
- `next-step` untouched; no UI; no runtime generation → not in any task (out of scope). ✓
- Manual proof (stage shift + specialist voice) → Task 4. ✓

**Placeholder scan:** No TBD/TODO; Task 1 embeds the full data verbatim; the "confirm the modal's dept variable name" and "match the existing filter pattern" notes are directed verifications with a STOP/fallback, not placeholders. ✓

**Type consistency:** `DepartmentFoundation` / `DEPARTMENT_FOUNDATIONS` / `departmentBlock(k, stage)` / `departmentBrief(k)` identical across Tasks 1–3. `deptKey?: string` consistent on `RunArgs`, the run-task `fields`, and all four call sites. `stageFocus` keys == `OB_STAGES`; department keys == the 8 fixed keys. ✓
