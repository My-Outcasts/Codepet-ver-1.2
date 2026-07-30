// The one home for cleaning the founder's free-text brief. Every field of the brief is text the
// user (or byte's enrichment) typed, so it can be junk: empty/whitespace, a single char, all
// digits ("1"), or — most visibly — their raw signup email when the address landed in the name
// field. `normalizeBrief` cleans the brief once as it enters the store, so NO downstream surface
// (the hero node, the 3D map, byte's chat, its grounding) ever renders garbage; the field-level
// rules (`cleanCompanyName`, `meaningfulText`) live here so display fallbacks and the boundary
// share a single definition of "junk".
import type { CompanyBrief } from './firebase/schema';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The founder's company name, trimmed — or null when it's junk (empty, single char, all-digits,
 *  or a raw email). Callers fall back to their own generic ("Your company" / "your company"). */
export function cleanCompanyName(raw?: string | null): string | null {
  const v = raw?.trim() ?? '';
  if (v.length < 2 || /^\d+$/.test(v) || EMAIL_RE.test(v)) return null;
  return v;
}

/** A brief text field that carries real signal — trimmed, at least `min` chars, not all digits.
 *  Used to pick the best display text and decide what's worth grounding byte on. */
export function meaningfulText(s?: string | null, min = 6): string | null {
  const v = s?.trim();
  return v && v.length >= min && !/^\d+$/.test(v) ? v : null;
}

/**
 * Normalize a brief as it enters the store: trim every string field (dropping empties) and null
 * a junk company name via `cleanCompanyName`, so no surface ever sees garbage. Conservative —
 * it only removes clearly-invalid values; real content is preserved verbatim (just trimmed).
 * Idempotent, so it's safe to apply at every write site.
 */
export function normalizeBrief(brief: CompanyBrief): CompanyBrief {
  const trim = (s?: string): string | undefined => {
    const v = s?.trim();
    return v ? v : undefined;
  };
  return {
    ...brief,
    founderName: trim(brief.founderName),
    role: trim(brief.role),
    tech: trim(brief.tech),
    stage: trim(brief.stage),
    // The company name gets the full junk guard (email / all-digits / single char are dropped).
    projectName: cleanCompanyName(brief.projectName) ?? undefined,
    oneLiner: trim(brief.oneLiner),
    summary: trim(brief.summary),
    notes: trim(brief.notes),
    link: trim(brief.link),
    audience: trim(brief.audience),
    goal: trim(brief.goal),
    traction: trim(brief.traction),
    problem: trim(brief.problem),
    categories: Array.isArray(brief.categories)
      ? brief.categories.map((c) => c?.trim()).filter((c): c is string => Boolean(c))
      : brief.categories,
  };
}
