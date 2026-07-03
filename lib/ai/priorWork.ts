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
  /** Max items to ground on (token budget). Default 4. */
  max?: number;
  /** Max same-department items before cross-department work gets slots. Default 2. */
  sameDeptMax?: number;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Choose which prior deliverables to ground the current task on. `items` are assumed
 * newest-first. Strategy: up to `sameDeptMax` from the current department (most
 * relevant), then fill remaining slots with the most-recent work from OTHER departments
 * (so byte stays consistent across the company), then top up with any leftover. The
 * current task's own approved version is excluded. Order-preserving and pure.
 */
export function selectPriorWork(items: PriorItem[], opts: SelectOptions = {}): PriorItem[] {
  const max = opts.max ?? 4;
  const sameDeptMax = opts.sameDeptMax ?? 2;
  const exclude = opts.excludeTitle ? norm(opts.excludeTitle) : '';
  const dept = opts.deptName ? norm(opts.deptName) : '';

  const usable = items.filter(
    (it) => it.title.trim() && it.out.trim() && (!exclude || norm(it.title) !== exclude),
  );
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
