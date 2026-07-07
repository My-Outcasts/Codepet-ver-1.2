# Overview first-run project briefing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On first run, byte opens the Overview with a one-time, brief-grounded analysis of the founder's project + a "how to read this map" key, then hands off to the existing spotlight.

**Architecture:** A pure analysis module (`lib/ai/projectAnalysis.ts`) defines the `ProjectAnalysis` shape, JSON schema, system prompt, and view helpers. A new auth-gated route (`/api/project-analysis`) generates it once from the server-loaded brief (mirroring `/api/personalize`). A thin client helper fetches+validates it; the store persists it to `companies/{uid}.projectAnalysis` (one-time, like `personalizedAt`) and exposes an idempotent `ensureProjectAnalysis()` trigger. `OverviewIntro` renders the analysis as labeled rows + the map key; the spotlight/beacon/breadcrumb/graph are untouched.

**Tech Stack:** Next.js 16 / React 19, TypeScript, Firebase (Firestore + Admin token verify), Anthropic `claude-opus-4-8` via the shared `generateJson`, node-env Vitest (no React Testing Library).

## Global Constraints

- **Grounding / anti-fabrication:** the analysis uses ONLY the founder's real brief (`briefToContext`). byte must not invent traction/numbers/facts; a thin brief → honest & general, never fabricated. Mirror the existing `BYTE_SYSTEM` grounding.
- **One live call, one-time, persisted:** generate once, persist to `companies/{uid}.projectAnalysis` + stamp `analyzedAt`; never regenerate; reopening costs nothing.
- **Records usage but is NOT 429-gated:** pass `onUsage: usageSink(uid, idToken, 'project-analysis')` (counts toward the daily total) but do NOT call `enforceDailyLimit` — like `personalize`/`scaffold`, a one-time first-run read must never be blocked.
- **Auth-gated:** verify the Firebase ID token; missing/invalid → 401. Load the brief server-side by the verified uid (`loadServerBrief`), client brief only as fallback. No brief ⇒ return `{}` so the client keeps the fallback intro.
- **Graceful, never a dead-end:** any failure (no brief / error / partial payload) → analysis absent → the panel degrades to the map-only intro. First-run is never blocked.
- **Exact five analysis fields:** `building`, `stage`, `edge`, `watchOut`, `focusNow` — nothing more (YAGNI).
- **Text only:** analysis strings render as text (React escapes them); byte never emits markup here.
- **Untouched:** the spotlight phase machine (`lib/overviewIntro.ts`), `ByteGuide` beacon, `StageRibbon`, bottom legend, `openDept`, the map/graph, `INTRO_SEEN_KEY` gating, and Firestore security rules (it's a field on the owner's own company doc).
- Run `npm run format:check` before pushing (CI runs `prettier --check .` repo-wide, incl. docs).

---

## File Structure

- **Create** `lib/ai/projectAnalysis.ts` — pure: type, schema, system, prompt, `isUsableAnalysis`, `analysisRows`.
- **Create** `lib/ai/projectAnalysis.test.ts` — node-env unit tests.
- **Create** `lib/ai/analyzeProject.ts` — `'use client'` fetch+validate helper.
- **Create** `app/api/project-analysis/route.ts` — auth-gated generation route.
- **Modify** `lib/firebase/schema.ts` — add `projectAnalysis?` + `analyzedAt?` to `CompanyDoc`.
- **Modify** `lib/firebase/companyData.ts` — `persistProjectAnalysis` + hydrate in `loadCompanyData` + `CompanyData.projectAnalysis`.
- **Modify** `lib/store.tsx` — `projectAnalysis`/`analysisLoading` state, `ensureProjectAnalysis()` action, hydrate, expose on context.
- **Rewrite** `components/views/overview/OverviewIntro.tsx` — briefing panel (analysis rows + map key).
- **Modify** `components/views/OverviewView.tsx` — pass analysis/loading, trigger `ensureProjectAnalysis()`.

---

## Task 1: Pure analysis module

**Files:**

- Create: `lib/ai/projectAnalysis.ts`
- Test: `lib/ai/projectAnalysis.test.ts`

**Interfaces:**

- Produces: `ProjectAnalysis`, `PROJECT_ANALYSIS_SCHEMA`, `ANALYSIS_SYSTEM`, `analysisPrompt(context: string): string`, `isUsableAnalysis(a: unknown): a is ProjectAnalysis`, `analysisRows(a: ProjectAnalysis): Array<{ label: string; value: string }>` — consumed by Tasks 3 & 5.

- [ ] **Step 1: Write the failing test**

Create `lib/ai/projectAnalysis.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  isUsableAnalysis,
  analysisRows,
  analysisPrompt,
  PROJECT_ANALYSIS_SCHEMA,
  type ProjectAnalysis,
} from './projectAnalysis';

const full: ProjectAnalysis = {
  building: 'An AI coding companion for solo founders.',
  stage: 'Launch stage, pre-revenue.',
  edge: 'The guided one-move-at-a-time map.',
  watchOut: 'First-run activation.',
  focusNow: 'Design + Engineering first, Marketing close behind.',
};

describe('isUsableAnalysis', () => {
  it('accepts a full five-field object', () => {
    expect(isUsableAnalysis(full)).toBe(true);
  });
  it('rejects when any field is missing', () => {
    for (const k of Object.keys(full) as (keyof ProjectAnalysis)[]) {
      const partial = { ...full };
      delete partial[k];
      expect(isUsableAnalysis(partial)).toBe(false);
    }
  });
  it('rejects empty or whitespace-only fields', () => {
    expect(isUsableAnalysis({ ...full, edge: '' })).toBe(false);
    expect(isUsableAnalysis({ ...full, edge: '   ' })).toBe(false);
  });
  it('rejects non-string fields and non-objects', () => {
    expect(isUsableAnalysis({ ...full, stage: 3 })).toBe(false);
    expect(isUsableAnalysis(null)).toBe(false);
    expect(isUsableAnalysis('nope')).toBe(false);
  });
});

describe('analysisRows', () => {
  it('returns the five rows in fixed order with the right labels', () => {
    const rows = analysisRows(full);
    expect(rows.map((r) => r.label)).toEqual([
      "You're building",
      'Where you are',
      'Your edge',
      'Watch out',
      'Focus now',
    ]);
    expect(rows.map((r) => r.value)).toEqual([
      full.building,
      full.stage,
      full.edge,
      full.watchOut,
      full.focusNow,
    ]);
  });
});

describe('analysisPrompt / schema', () => {
  it('embeds the context', () => {
    expect(analysisPrompt('CONTEXT_SENTINEL')).toContain('CONTEXT_SENTINEL');
  });
  it('schema requires all five fields and forbids extras', () => {
    expect(PROJECT_ANALYSIS_SCHEMA.additionalProperties).toBe(false);
    expect(PROJECT_ANALYSIS_SCHEMA.required).toEqual([
      'building',
      'stage',
      'edge',
      'watchOut',
      'focusNow',
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/ai/projectAnalysis.test.ts`
Expected: FAIL — `Cannot find module './projectAnalysis'`.

- [ ] **Step 3: Write the implementation**

Create `lib/ai/projectAnalysis.ts`:

```ts
// byte's one-time, brief-grounded read of the founder's project, shown on the Overview
// first run before the "next move" hand-off. Pure: the type, the structured-output
// schema, the system prompt, and the view helpers live here so they're unit-testable
// (node-env Vitest) and shared by the route (generation) and OverviewIntro (render).

export interface ProjectAnalysis {
  /** What they're building and who it's for. */
  building: string;
  /** Where they are right now (stage + honest read of momentum). */
  stage: string;
  /** Their apparent advantage / what's working. */
  edge: string;
  /** The main risk or gap to watch at this stage. */
  watchOut: string;
  /** What to focus on next — names the departments byte set up and why. */
  focusNow: string;
}

const FIELDS: (keyof ProjectAnalysis)[] = ['building', 'stage', 'edge', 'watchOut', 'focusNow'];

// Structured-output schema handed to generateJson. All five fields required, no extras,
// so a garbled payload can't render blank rows.
export const PROJECT_ANALYSIS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    building: {
      type: 'string',
      description: "What the founder is building and who it's for, in one or two sentences.",
    },
    stage: {
      type: 'string',
      description: 'Where the product is right now: their stage plus an honest read of momentum.',
    },
    edge: { type: 'string', description: "The founder's apparent advantage or what's working." },
    watchOut: {
      type: 'string',
      description: 'The single most important risk or gap to watch at this stage.',
    },
    focusNow: {
      type: 'string',
      description:
        'What to focus on next. Name the departments a company like this needs first and why, so it connects to the company map.',
    },
  },
  required: ['building', 'stage', 'edge', 'watchOut', 'focusNow'],
};

export const ANALYSIS_SYSTEM = `You are byte, the AI building companion inside Codepet, giving a founder your first honest read of THEIR project so they understand where they stand before you point at the next move.

Voice: warm, plain-language, confident, specific. First person ("you're…", "I've set up…"). No hype, no emoji, no clichés, no markdown.

Grounding (critical): use ONLY what the founder has actually told you. Never invent traction, numbers, users, revenue, or facts the brief doesn't state. If something isn't known, say so plainly and name it as a thing worth pinning down — do not fabricate. Keep every field to one or two tight sentences.`;

export function analysisPrompt(context: string): string {
  return [
    `Here is everything I know about this founder's company:`,
    context,
    '',
    `Write my read of their project as five short fields:`,
    `- building: what they're building and who it's for.`,
    `- stage: where they are now (their stage + an honest read of momentum).`,
    `- edge: their apparent advantage or what's working.`,
    `- watchOut: the single biggest risk or gap to watch at this stage.`,
    `- focusNow: what to focus on next — name the departments a company like this needs first and why.`,
    `Ground every field in what's actually known; if a field is thin, be honest rather than inventing.`,
  ].join('\n');
}

// True only if every field is a non-empty (non-whitespace) string. Guards the UI so a
// partial/garbled payload is treated as absent (→ fallback intro), never blank rows.
export function isUsableAnalysis(a: unknown): a is ProjectAnalysis {
  if (!a || typeof a !== 'object') return false;
  const o = a as Record<string, unknown>;
  return FIELDS.every((k) => typeof o[k] === 'string' && (o[k] as string).trim().length > 0);
}

// The labeled rows OverviewIntro renders — one source of truth for order + labels.
export function analysisRows(a: ProjectAnalysis): Array<{ label: string; value: string }> {
  return [
    { label: "You're building", value: a.building },
    { label: 'Where you are', value: a.stage },
    { label: 'Your edge', value: a.edge },
    { label: 'Watch out', value: a.watchOut },
    { label: 'Focus now', value: a.focusNow },
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/ai/projectAnalysis.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit` (only the pre-existing unrelated `firestore.rules.test.ts` errors) and `npx eslint lib/ai/projectAnalysis.ts lib/ai/projectAnalysis.test.ts` (clean).

- [ ] **Step 6: Commit**

```bash
git add lib/ai/projectAnalysis.ts lib/ai/projectAnalysis.test.ts
git commit -m "feat(ai): pure project-analysis module (schema, prompt, view helpers)"
```

---

## Task 2: Schema field + persistence

**Files:**

- Modify: `lib/firebase/schema.ts`
- Modify: `lib/firebase/companyData.ts`

**Interfaces:**

- Consumes: `ProjectAnalysis` from `lib/ai/projectAnalysis.ts` (Task 1).
- Produces: `CompanyDoc.projectAnalysis?` / `.analyzedAt?`; `persistProjectAnalysis(companyId: string, analysis: ProjectAnalysis): Promise<void>`; `CompanyData.projectAnalysis?: ProjectAnalysis` returned by `loadCompanyData`.

- [ ] **Step 1: Add the fields to `CompanyDoc` (`lib/firebase/schema.ts`)**

At the top of `schema.ts`, add the import (near the other imports; `ProjectAnalysis` is a type-only import):

```ts
import type { ProjectAnalysis } from '../ai/projectAnalysis';
```

In `interface CompanyDoc`, directly after the `personalizedAt?: Millis;` line, add:

```ts
  /** byte's one-time project analysis (shown on the Overview first run). */
  projectAnalysis?: ProjectAnalysis;
  /** When the one-time project analysis ran. Absent ⇒ never analyzed. */
  analyzedAt?: Millis;
```

- [ ] **Step 2: Persist helper + hydration (`lib/firebase/companyData.ts`)**

Add a `ProjectAnalysis` type-only import at the top:

```ts
import type { ProjectAnalysis } from '../ai/projectAnalysis';
```

Add `projectAnalysis?` to the `CompanyData` interface (after `roadmapStage?`):

```ts
  /** byte's one-time project analysis; undefined ⇒ not generated yet. */
  projectAnalysis?: ProjectAnalysis;
```

In `loadCompanyData`, extend the returned object (it reads `company` already) with:

```ts
    projectAnalysis: company?.projectAnalysis as ProjectAnalysis | undefined,
```

Add the persist helper next to `persistPersonalization` (same file), mirroring its one-time-stamp pattern:

```ts
/**
 * Persist byte's one-time project analysis and stamp `analyzedAt` so it never
 * regenerates (returning users hydrate it via loadCompanyData).
 */
export async function persistProjectAnalysis(
  companyId: string,
  analysis: ProjectAnalysis,
): Promise<void> {
  const now = Date.now();
  await updateDoc(doc(getDb(), paths.company(companyId)), {
    projectAnalysis: analysis,
    analyzedAt: now,
    updatedAt: now,
  });
}
```

(`updateDoc`, `doc`, `getDb`, `paths` are already imported in this file — confirm and reuse; do not add duplicate imports.)

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit` (only the pre-existing `firestore.rules.test.ts` errors) and `npx eslint lib/firebase/schema.ts lib/firebase/companyData.ts` (clean).

- [ ] **Step 4: Run the unit suite (nothing regressed)**

Run: `npx vitest run`
Expected: all pass (schema round-trip tests, if present, still green).

- [ ] **Step 5: Commit**

```bash
git add lib/firebase/schema.ts lib/firebase/companyData.ts
git commit -m "feat(firebase): persist + hydrate byte's one-time project analysis"
```

---

## Task 3: Generation route + client fetch helper

**Files:**

- Create: `app/api/project-analysis/route.ts`
- Create: `lib/ai/analyzeProject.ts`

**Interfaces:**

- Consumes: `ANALYSIS_SYSTEM`, `analysisPrompt`, `PROJECT_ANALYSIS_SCHEMA`, `isUsableAnalysis`, `ProjectAnalysis` (Task 1); `verifyIdToken`, `briefToContext`, `loadServerBrief`, `usageSink`, `getClient`, `generateJson`, `aiErrorResponse` (existing); `authHeader` from `lib/ai/runTask` (existing).
- Produces: `fetchProjectAnalysis(brief?: CompanyBrief): Promise<ProjectAnalysis | null>` — consumed by the store (Task 4).

- [ ] **Step 1: Create the route (`app/api/project-analysis/route.ts`)**

Mirror `/api/personalize` exactly (auth, brief load, generate, usage sink — no `enforceDailyLimit`):

```ts
// byte's one-time project analysis. Right after onboarding (or on the first Overview
// visit for older accounts), byte reads the founder's brief and writes a short,
// grounded read of their project — shown on the Overview first run before the "next
// move" hand-off. Like /api/personalize and /api/scaffold: auth-gated, key server-side,
// brief loaded by the VERIFIED uid, usage recorded (not 429-gated — a one-time first-run
// read must never be blocked).
import { verifyIdToken } from '@/lib/firebase/admin';
import { briefToContext } from '@/lib/ai/brief';
import { loadServerBrief } from '@/lib/firebase/serverBrief';
import { usageSink } from '@/lib/firebase/serverUsage';
import { getClient, generateJson, aiErrorResponse } from '@/lib/ai/client';
import {
  ANALYSIS_SYSTEM,
  analysisPrompt,
  PROJECT_ANALYSIS_SCHEMA,
  isUsableAnalysis,
  type ProjectAnalysis,
} from '@/lib/ai/projectAnalysis';

export const runtime = 'nodejs';

interface AnalysisBody {
  brief?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  const authz = req.headers.get('authorization') ?? '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  if (!idToken) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  let uid: string;
  try {
    const decoded = await verifyIdToken(idToken);
    uid = decoded.uid;
  } catch {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let client: ReturnType<typeof getClient>;
  try {
    client = getClient();
  } catch (err) {
    return aiErrorResponse(err, 'not_configured');
  }

  let body: AnalysisBody = {};
  try {
    body = (await req.json()) as AnalysisBody;
  } catch {
    // Body optional — the brief is preferentially loaded server-side.
  }

  const serverBrief = await loadServerBrief(uid, idToken);
  const context = briefToContext(serverBrief) ?? briefToContext(body.brief);
  if (!context) {
    // No brief ⇒ nothing to analyze; client keeps the fallback intro.
    return Response.json({});
  }

  try {
    const parsed = await generateJson<Partial<ProjectAnalysis>>({
      client,
      system: ANALYSIS_SYSTEM,
      prompt: analysisPrompt(context),
      maxTokens: 2048,
      label: 'project-analysis',
      schema: PROJECT_ANALYSIS_SCHEMA,
      onUsage: usageSink(uid, idToken, 'project-analysis'),
    });
    // Guard the payload server-side too; an unusable one ⇒ empty ⇒ client fallback.
    return Response.json(isUsableAnalysis(parsed) ? parsed : {});
  } catch (err) {
    return aiErrorResponse(err, 'generation_failed');
  }
}
```

- [ ] **Step 2: Create the client fetch helper (`lib/ai/analyzeProject.ts`)**

```ts
'use client';
// Client side of the one-time project analysis: POST the brief to /api/project-analysis
// and return a validated ProjectAnalysis (or null). Persisting + state live in the store
// (which owns projectAnalysis), so this helper only fetches + validates. Best-effort:
// any failure returns null and the caller keeps the fallback intro.
import { authHeader } from './runTask';
import { isUsableAnalysis, type ProjectAnalysis } from './projectAnalysis';
import type { CompanyBrief } from '../firebase/schema';

export async function fetchProjectAnalysis(brief?: CompanyBrief): Promise<ProjectAnalysis | null> {
  try {
    const res = await fetch('/api/project-analysis', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ brief }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    return isUsableAnalysis(data) ? data : null;
  } catch (err) {
    console.error('[project-analysis] failed', err);
    return null;
  }
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit` (only the pre-existing `firestore.rules.test.ts` errors) and `npx eslint app/api/project-analysis/route.ts lib/ai/analyzeProject.ts` (clean).

- [ ] **Step 4: Run the unit suite**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/project-analysis/route.ts lib/ai/analyzeProject.ts
git commit -m "feat(ai): /api/project-analysis route + client fetch helper"
```

---

## Task 4: Store wiring — state, hydration, idempotent trigger

**Files:**

- Modify: `lib/store.tsx`

**Interfaces:**

- Consumes: `fetchProjectAnalysis` (Task 3), `persistProjectAnalysis` (Task 2), `ProjectAnalysis` (Task 1); existing `loadCompanyData`, `brief`, `companyId`.
- Produces (on the `useApp()` context value + its type): `projectAnalysis: ProjectAnalysis | null`, `analysisLoading: boolean`, `ensureProjectAnalysis: () => void` — consumed by `OverviewView` (Task 5).

- [ ] **Step 1: Imports**

Add near the other `lib/ai` / `lib/firebase` imports at the top of `lib/store.tsx`:

```ts
import { fetchProjectAnalysis } from './ai/analyzeProject';
import { persistProjectAnalysis } from './firebase/companyData';
import type { ProjectAnalysis } from './ai/projectAnalysis';
```

(`persistProjectAnalysis` — if `companyData` is already imported as a named-group import, add `persistProjectAnalysis` to that existing import list instead of a second import line.)

- [ ] **Step 2: Type members**

In the context type interface (the one declaring `brief: CompanyBrief;` and `decisions: DecisionEntry[];` — around the `finishOnboarding`/`scaffoldFromOnboarding` block), add:

```ts
  /** byte's one-time project analysis; null until generated. */
  projectAnalysis: ProjectAnalysis | null;
  /** True while the one-time analysis call is in flight (drives the intro placeholder). */
  analysisLoading: boolean;
  /** Idempotent: generate + persist the analysis once if missing. No-op otherwise. */
  ensureProjectAnalysis: () => void;
```

- [ ] **Step 3: State + hydration**

Next to `const [brief, setBrief] = useState<CompanyBrief>({});` add:

```ts
const [projectAnalysis, setProjectAnalysis] = useState<ProjectAnalysis | null>(null);
const [analysisLoading, setAnalysisLoading] = useState(false);
const analysisInFlight = useRef(false);
```

In the `loadCompanyData(companyId).then(({ ... }) => { ... })` destructure, add `projectAnalysis: pa` and set it:

```ts
      .then(({ library: lib, brief: b, onboardedAt, roadmapStage, chat, decisions: dec, projectAnalysis: pa }) => {
        // ...existing setters...
        setProjectAnalysis(pa ?? null);
```

(Reset it on account switch alongside the existing resets: `setProjectAnalysis(null); setAnalysisLoading(false); analysisInFlight.current = false;` wherever `setBrief`/`setDecisions` are reset for a new company.)

- [ ] **Step 4: The idempotent action**

Add a `useCallback` near the other actions:

```ts
const ensureProjectAnalysis = useCallback(() => {
  // One-time: skip if we already have it, or a call is in flight, or there's no
  // company/brief to analyze. Best-effort — failure leaves it null (fallback intro).
  if (projectAnalysis || analysisInFlight.current || !companyId) return;
  const hasBrief = brief && Object.keys(brief).length > 0;
  if (!hasBrief) return;
  analysisInFlight.current = true;
  setAnalysisLoading(true);
  fetchProjectAnalysis(brief)
    .then((a) => {
      if (a) {
        setProjectAnalysis(a);
        persistProjectAnalysis(companyId, a).catch((err) =>
          console.error('[project-analysis] persist failed', err),
        );
      }
    })
    .finally(() => {
      analysisInFlight.current = false;
      setAnalysisLoading(false);
    });
}, [projectAnalysis, companyId, brief]);
```

- [ ] **Step 5: Expose on the context value**

In the object passed to the provider's `value=` (where `brief`, `decisions`, actions are listed), add:

```ts
      projectAnalysis,
      analysisLoading,
      ensureProjectAnalysis,
```

(If the value object is wrapped in `useMemo`, add these three to its dependency array.)

- [ ] **Step 6: Typecheck + lint + full suite**

Run: `npx tsc --noEmit` (only pre-existing `firestore.rules.test.ts` errors), `npx eslint lib/store.tsx` (0 errors/0 warnings — watch React-Compiler rules: the `useCallback` deps must be exactly `[projectAnalysis, companyId, brief]`; `analysisInFlight`/setters are stable and excluded), then `npx vitest run` (all pass).

- [ ] **Step 7: Commit**

```bash
git add lib/store.tsx
git commit -m "feat(store): project-analysis state + idempotent ensureProjectAnalysis"
```

---

## Task 5: Enriched briefing panel + OverviewView trigger

**Files:**

- Rewrite: `components/views/overview/OverviewIntro.tsx`
- Modify: `components/views/OverviewView.tsx`

**Interfaces:**

- Consumes: `analysisRows`, `ProjectAnalysis` (Task 1); `projectAnalysis`, `analysisLoading`, `ensureProjectAnalysis` from `useApp()` (Task 4); existing `GUIDE_HEX`.
- Produces: the updated `OverviewIntro` (new props) rendered by `OverviewView`.

- [ ] **Step 1: Rewrite `components/views/overview/OverviewIntro.tsx`**

Replace the entire file with (adds analysis rows + always-on map key; drops `showLegend`):

```tsx
'use client';
// byte's first-visit briefing on the Overview: a slim card that opens with byte's read
// of THIS project (labeled rows, or a loading/absent state) + a compact "how to read
// this map" key, then hands off to the lit next move. Controlled by OverviewView (which
// owns the phase, localStorage, and the analysis fetch); this component only renders and
// reports intent via onReveal / onDismiss.
import { GUIDE_HEX } from '@/lib/overviewIntro';
import { analysisRows, type ProjectAnalysis } from '@/lib/ai/projectAnalysis';

export default function OverviewIntro({
  analysis,
  analysisLoading,
  onReveal,
  onDismiss,
}: {
  analysis: ProjectAnalysis | null;
  analysisLoading: boolean;
  onReveal: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      onClick={onDismiss}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 8,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'rgba(4,3,10,0.55)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 380,
          maxWidth: '90vw',
          maxHeight: '86vh',
          overflowY: 'auto',
          padding: '24px 24px 22px',
          background: 'rgba(16,14,28,0.96)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: `1px solid ${GUIDE_HEX}40`,
          borderRadius: 18,
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: '1.5px',
            fontWeight: 700,
            color: GUIDE_HEX,
            textTransform: 'uppercase',
          }}
        >
          byte · your companion
        </div>
        <div
          style={{
            fontSize: 20,
            fontWeight: 650,
            color: '#F7F5FF',
            letterSpacing: '-.3px',
            marginTop: 10,
            lineHeight: 1.25,
          }}
        >
          Here&apos;s my read of your project.
        </div>

        {/* Analysis: loading → ready → absent */}
        {analysisLoading && !analysis && (
          <div
            style={{
              marginTop: 14,
              fontSize: 13,
              lineHeight: 1.6,
              color: 'rgba(245,243,255,.55)',
              fontStyle: 'italic',
            }}
          >
            byte is sizing up your project…
          </div>
        )}
        {analysis && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {analysisRows(analysis).map((r) => (
              <div key={r.label}>
                <div
                  style={{
                    fontSize: 10,
                    letterSpacing: '.6px',
                    textTransform: 'uppercase',
                    color: `${GUIDE_HEX}bf`,
                  }}
                >
                  {r.label}
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    lineHeight: 1.45,
                    color: 'rgba(245,243,255,.82)',
                    marginTop: 2,
                  }}
                >
                  {r.value}
                </div>
              </div>
            ))}
          </div>
        )}
        {!analysis && !analysisLoading && (
          <div
            style={{
              fontSize: 13.5,
              lineHeight: 1.6,
              color: 'rgba(245,243,255,.72)',
              marginTop: 12,
            }}
          >
            This whole map is your company. I always keep{' '}
            <b style={{ color: '#F5F3FF' }}>one move lit</b> — the single next thing that matters.
          </div>
        )}

        {/* How to read this map — always shown now */}
        <div
          style={{
            marginTop: 16,
            paddingTop: 14,
            borderTop: '1px solid rgba(255,255,255,.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: 11,
              letterSpacing: '.5px',
              textTransform: 'uppercase',
              color: 'rgba(245,243,255,.5)',
            }}
          >
            How to read this map
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.55, color: 'rgba(245,243,255,.68)' }}>
            The <b style={{ color: '#F5F3FF' }}>center</b> is your whole company; each{' '}
            <b style={{ color: '#F5F3FF' }}>branch</b> is a department I set up; the small dots are
            its tasks. The strip up top is your <b style={{ color: '#F5F3FF' }}>journey stage</b>.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            <LegendRow c={GUIDE_HEX} t="Cyan = your next move (always one, lit)" />
            <LegendRow c="#8B5CF6" t="Purple = I'll do it" />
            <LegendRow c="#FDB022" t="Gold = I draft it, you approve" />
            <LegendRow c="#3B82F6" t="Blue = needs you" />
            <LegendRow c="#34D399" t="Green = done" />
          </div>
        </div>

        <button
          onClick={onReveal}
          style={{
            marginTop: 20,
            width: '100%',
            fontFamily: 'inherit',
            fontSize: 13.5,
            fontWeight: 700,
            color: '#0B0616',
            background: GUIDE_HEX,
            border: 0,
            borderRadius: 10,
            padding: '11px 26px',
            cursor: 'pointer',
          }}
        >
          Show me my next move ▸
        </button>
        <div
          style={{ fontSize: 11, color: 'rgba(245,243,255,.4)', textAlign: 'center', marginTop: 9 }}
        >
          I&apos;ll explain the map as we go.
        </div>
      </div>
    </div>
  );
}

function LegendRow({ c, t }: { c: string; t: string }) {
  return (
    <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: c,
          boxShadow: `0 0 8px ${c}`,
          flex: 'none',
        }}
      />
      <div style={{ fontSize: 12.5, color: 'rgba(245,243,255,.72)' }}>{t}</div>
    </div>
  );
}
```

- [ ] **Step 2: Wire `OverviewView.tsx`**

(a) Add to the `useApp()` destructure (alongside `brief`, `nextStep`, …):

```ts
    projectAnalysis,
    analysisLoading,
    ensureProjectAnalysis,
```

(b) Trigger the one-time generation when the intro is (or will be) shown. Add an effect near the other intro effects:

```tsx
useEffect(() => {
  if (introPhase === 'intro') ensureProjectAnalysis();
}, [introPhase, ensureProjectAnalysis]);
```

(c) Update the `OverviewIntro` render (the `introPhase === 'intro'` block) to pass the new props and drop `showLegend`:

```tsx
{
  introPhase === 'intro' && (
    <OverviewIntro
      analysis={projectAnalysis}
      analysisLoading={analysisLoading}
      onReveal={handleIntroReveal}
      onDismiss={handleIntroDismiss}
    />
  );
}
```

(If `hasSeenIntro` becomes unused after dropping `showLegend`, leave it — it still gates other intro logic; only remove it if `eslint` flags it as unused.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors (only the pre-existing `firestore.rules.test.ts` errors).

- [ ] **Step 4: Lint the changed files (0 errors / 0 warnings)**

Run: `npx eslint components/views/overview/OverviewIntro.tsx components/views/OverviewView.tsx`
Expected: clean. Watch the React-Compiler rules — the new effect's deps are exactly `[introPhase, ensureProjectAnalysis]`; no ref reads during render; no unused vars (remove `showLegend`/`hasSeenIntro` only if flagged).

- [ ] **Step 5: Full unit suite + format**

Run: `npx vitest run` (all pass), then `npm run format:check` (clean; if not, `npx prettier --write` the changed files and re-check).

- [ ] **Step 6: Commit**

```bash
git add components/views/overview/OverviewIntro.tsx components/views/OverviewView.tsx
git commit -m "feat(overview): first-run project briefing panel + trigger"
```

---

## Self-Review Notes (author checklist — done)

- **Spec coverage:** five-field analysis → Task 1 type/schema/rows; anti-fabrication → `ANALYSIS_SYSTEM`; one live call + usage-not-gated → Task 3 route; one-time persist → Task 2 `persistProjectAnalysis` + `analyzedAt`; idempotent trigger → Task 4 `ensureProjectAnalysis`; loading/ready/absent panel + always-on map key → Task 5; reopen shows persisted analysis (no call) → guarded by `projectAnalysis` presence; graceful fallback everywhere → `isUsableAnalysis` guard + null returns.
- **Type consistency:** `ProjectAnalysis` defined once (Task 1), imported everywhere; `fetchProjectAnalysis`/`persistProjectAnalysis`/`ensureProjectAnalysis` names match across Tasks 3→4→5; route label `'project-analysis'` consistent.
- **No placeholders:** every step has full code or exact edits with anchors.
- **Lint traps pre-empted:** `useCallback`/effect dep arrays specified exactly (React-Compiler plugin); type-only imports for `ProjectAnalysis`; no new 429 path; no security-rules change; escaped text only.
- **Dependency order:** 1 (types) → 2 (persist) → 3 (route/client) → 4 (store) → 5 (UI); each independently reviewable.

```

```
