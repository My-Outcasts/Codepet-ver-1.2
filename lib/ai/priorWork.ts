// Grounding byte in what it has already shipped. When byte produces or revises a
// deliverable, feeding it the founder's already-approved work makes new output
// consistent with the company's existing decisions (naming, pricing, positioning)
// instead of re-inventing them from a one-line brief.
//
// This module is pure and dependency-free (no Firestore, no network) so the selection
// and compaction logic is unit-tested in plain node. The library read lives in
// lib/firebase/serverLibrary.ts; /api/run-task wires the two together.

/** A compact view of one approved deliverable — the fields worth grounding on. */
export interface PriorItem {
  title: string;
  /** Department display name (e.g. "Marketing"). */
  dept: string;
  /** Department key (e.g. "mkt"). */
  k: string;
  /** Deliverable kind (e.g. "site", "sheet", "post"). */
  type: string;
  /** Plain-text form of the deliverable — the high-signal, low-token summary. */
  out: string;
}

export interface SelectOptions {
  /** The current task's department name — same-dept work is the strongest grounding. */
  deptName?: string;
  /** The current task's title — excluded so byte isn't fed its own prior version. */
  excludeTitle?: string;
  /**
   * What the current task is about (its title + intended-deliverable hint + any revise
   * note). When present, prior work is ranked by RELEVANCE to this — so a launch post
   * pulls the pricing sheet and positioning doc it must be consistent with, even from
   * other departments — instead of just the newest same-dept items. When absent, falls
   * back to the recency + same-department strategy (no behaviour change).
   */
  query?: string;
  /** Max items to ground on (token budget). Default 4. */
  max?: number;
  /** Max same-department items before cross-department work gets slots. Default 2. */
  sameDeptMax?: number;
}

const norm = (s: string) => s.trim().toLowerCase();

// Words too common to carry signal for relevance matching.
const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'our',
  'your',
  'their',
  'this',
  'that',
  'with',
  'from',
  'into',
  'about',
  'are',
  'was',
  'were',
  'will',
  'has',
  'have',
  'not',
  'you',
  'each',
  'per',
  'its',
  'via',
  'onto',
]);

/** Split text into lowercased, de-duped content tokens (≥3 chars, no stopwords). */
function tokenize(s: string): Set<string> {
  const out = new Set<string>();
  for (const raw of s.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 3 && !STOPWORDS.has(raw)) out.add(raw);
  }
  return out;
}

// Only the head of each deliverable is scanned for relevance — enough to capture the
// subject without letting a long body dominate the token overlap (or cost cycles).
const SCORE_SCAN = 600;
// A title-token match is worth more than a body-token match: titles are dense signal.
const TITLE_WEIGHT = 3;
const OUT_WEIGHT = 1;
// Gentle same-department nudge: enough that same-dept wins on a tie, but a cross-dept
// item with a real title-token match still outranks an unrelated same-dept one.
const SAME_DEPT_BONUS = 2;

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

/**
 * Choose which prior deliverables to ground the current task on. `items` are assumed
 * newest-first.
 *
 * With a `query` (what the task is about): rank every usable item by relevance —
 * weighted title/body token overlap with the query, plus a small same-department bonus
 * — and take the top `max`. This spends the limited grounding budget on the work the
 * current task must actually stay consistent with, across departments.
 *
 * Without a query: the original recency + same-department strategy (up to `sameDeptMax`
 * same-dept, then newest cross-dept, then top up) — unchanged, so callers that don't
 * pass a query behave exactly as before.
 *
 * The current task's own approved version is excluded. Pure and deterministic (ties
 * keep newest-first order via a stable sort).
 */
export function selectPriorWork(items: PriorItem[], opts: SelectOptions = {}): PriorItem[] {
  const max = opts.max ?? 4;
  const exclude = opts.excludeTitle ? norm(opts.excludeTitle) : '';
  const dept = opts.deptName ? norm(opts.deptName) : '';

  const usable = items.filter(
    (it) => it.title.trim() && it.out.trim() && (!exclude || norm(it.title) !== exclude),
  );

  const queryTokens = opts.query ? tokenize(opts.query) : new Set<string>();
  if (queryTokens.size > 0) {
    // Relevance mode. Score with the original index as a stable, newest-first tiebreak.
    const scored = usable.map((it, i) => {
      const sameDept = dept ? norm(it.dept) === dept : false;
      const score =
        TITLE_WEIGHT * overlap(queryTokens, tokenize(it.title)) +
        OUT_WEIGHT * overlap(queryTokens, tokenize(it.out.slice(0, SCORE_SCAN))) +
        (sameDept ? SAME_DEPT_BONUS : 0);
      return { it, i, score };
    });
    scored.sort((a, b) => b.score - a.score || a.i - b.i);
    return scored.slice(0, max).map((s) => s.it);
  }

  // Fallback: recency + same-department (original behaviour).
  const sameDeptMax = opts.sameDeptMax ?? 2;
  const sameDept = dept ? usable.filter((it) => norm(it.dept) === dept) : [];
  const otherDept = dept ? usable.filter((it) => norm(it.dept) !== dept) : usable;

  const picked: PriorItem[] = [];
  const seen = new Set<string>();
  const take = (it: PriorItem) => {
    const key = norm(it.title);
    if (seen.has(key) || picked.length >= max) return;
    seen.add(key);
    picked.push(it);
  };

  sameDept.slice(0, sameDeptMax).forEach(take); // most relevant: same department
  otherDept.forEach(take); // cross-department awareness, newest first
  usable.forEach(take); // top up with any remaining same-dept items
  return picked;
}

/** Per-item plain-text budget so a few large deliverables can't blow the prompt. */
const OUT_CAP = 500;

/**
 * Render the selected prior work as a grounding block for the generation prompt.
 * Returns '' when there's nothing to ground on (caller omits the block entirely).
 */
export function composePriorWorkContext(items: PriorItem[]): string {
  if (!items.length) return '';
  const lines = items.map((it) => {
    const out = it.out.trim().replace(/\s+/g, ' ').slice(0, OUT_CAP);
    return `- [${it.dept}] ${it.title} (${it.type}): ${out}`;
  });
  return (
    'Already-approved work in this company — stay consistent with it. ' +
    'Do not contradict the naming, pricing, positioning, or decisions already shipped:\n' +
    lines.join('\n')
  );
}
