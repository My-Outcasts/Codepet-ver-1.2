// The project model — one structured snapshot of the founder's company that byte reads
// before it generates or advises. It unifies what used to be assembled ad-hoc per route
// (a one-paragraph brief here, a dept summary there) into a single, consistent block:
//   1. the narrative (product / stage / audience — from the onboarding brief)
//   2. a compact "what's shipped so far" digest (breadth across departments)
//   3. the current focus, when known
//
// "Derive fresh each run": this is composed on every call from already-persisted state,
// so it's always current, costs no extra model call, and can't drift. It's also a stable
// enough prefix to become the thing worth prompt-caching later. Pure + dependency-free
// (no Firestore, no network) so it unit-tests in plain node; the reads live in the
// serverBrief / serverLibrary loaders and the routes wire them in.
import { briefToContext } from './brief';
import type { PriorItem } from './priorWork';

/** The founder's single agreed next move, if one is known at call time. */
export interface Focus {
  title: string;
  why?: string;
}

/**
 * One durable decision the company has locked in — the kind of choice (pricing,
 * positioning, naming) that lives in no single deliverable. Keyed by `topic` so a newer
 * decision on the same topic replaces the old one (the drift guard). Phase 1 only reads
 * and renders these; the byte-maintained writer that extracts them is Phase 2.
 */
export interface DecisionEntry {
  topic: string;
  statement: string;
  /** Where the decision came from, e.g. "Finance / Pricing model". */
  source?: string;
  /** Millis of the last update — used to evict the oldest when capped. */
  updatedAt?: number;
}

export interface ProjectModelInput {
  /** The persisted brief (preferred). */
  brief: unknown;
  /** A client-passed brief to fall back on mid-onboarding, before the read settles. */
  fallbackBrief?: unknown;
  /** Approved deliverables (newest-first), for the shipped digest. */
  shipped?: PriorItem[];
  /** Decisions the founder has locked in, honored as constraints. */
  decisions?: DecisionEntry[];
  /** The current agreed focus, if the caller has one (e.g. the next-step pick). */
  focus?: Focus | null;
}

/** Hard cap on decisions carried in the model, to bound tokens and force curation. */
export const MAX_DECISIONS = 30;

/**
 * Coerce an untrusted value (e.g. the Firestore `decisions` field) into valid entries:
 * keep only those with a non-empty topic + statement, trim, and cap at MAX_DECISIONS
 * (keeping the most recently updated). Pure so it unit-tests and is reused by the reader.
 */
export function normalizeDecisions(raw: unknown, max = MAX_DECISIONS): DecisionEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: DecisionEntry[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const topic = typeof o.topic === 'string' ? o.topic.trim() : '';
    const statement = typeof o.statement === 'string' ? o.statement.trim() : '';
    if (!topic || !statement) continue;
    entries.push({
      topic,
      statement,
      source: typeof o.source === 'string' && o.source.trim() ? o.source.trim() : undefined,
      updatedAt:
        typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt) ? o.updatedAt : undefined,
    });
  }
  if (entries.length <= max) return entries;
  // Over cap: keep the most recently updated (undefined updatedAt sorts oldest).
  return [...entries].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, max);
}

/** Render locked-in decisions as a grounding block. '' when there are none. */
export function composeDecisions(decisions: DecisionEntry[]): string {
  if (!decisions.length) return '';
  const lines = decisions.map((d) => `- ${d.topic}: ${d.statement}`);
  return (
    'Decisions the founder has locked in — honor these; never contradict or silently re-open them:\n' +
    lines.join('\n') +
    '\nIf the current work genuinely conflicts with one, do NOT quietly override it and do NOT ignore the conflict: stay consistent with the decision, and add one short, clearly-marked note flagging the tension so the founder can decide (e.g. "Note: this holds to your decision that <…>; tell me if you want to revisit it").'
  );
}

export interface DigestOptions {
  /** Titles listed per department before it's truncated. Default 4. */
  maxPerDept?: number;
  /** Total titles across all departments. Default 16. */
  maxItems?: number;
}

/**
 * A breadth-first digest of shipped work, grouped by department:
 *   "Marketing: Landing page, Launch post · Finance: Pricing model"
 * Titles only (no content) so it stays cheap and complements the detailed prior-work
 * block. `items` are assumed newest-first, so per-department truncation keeps the newest.
 */
export function composeShippedDigest(items: PriorItem[], opts: DigestOptions = {}): string {
  const maxPerDept = opts.maxPerDept ?? 4;
  const maxItems = opts.maxItems ?? 16;
  const byDept = new Map<string, string[]>();
  let total = 0;
  for (const it of items) {
    const title = it.title.trim();
    if (!title) continue;
    if (total >= maxItems) break;
    const dept = it.dept.trim() || 'General';
    const list = byDept.get(dept) ?? [];
    if (list.length >= maxPerDept) continue;
    list.push(title);
    byDept.set(dept, list);
    total += 1;
  }
  return [...byDept.entries()].map(([dept, titles]) => `${dept}: ${titles.join(', ')}`).join(' · ');
}

/**
 * Compose the project model into a single grounding block. Returns '' when there's no
 * usable signal at all (no brief, no shipped work, no focus) so the caller can fall back
 * to a baseline product description.
 */
export function composeProjectModel(input: ProjectModelInput): string {
  const narrative = briefToContext(input.brief) ?? briefToContext(input.fallbackBrief);
  const shipped = input.shipped?.length ? composeShippedDigest(input.shipped) : '';

  const decisions = input.decisions?.length ? composeDecisions(input.decisions) : '';

  const parts: string[] = [];
  if (narrative) parts.push(narrative);
  if (decisions) parts.push(decisions);
  if (shipped) parts.push(`What the company has shipped so far — ${shipped}.`);
  if (input.focus?.title.trim()) {
    const why = input.focus.why?.trim();
    parts.push(`Current focus: ${input.focus.title.trim()}${why ? ` — ${why}` : ''}.`);
  }
  return parts.join('\n');
}
