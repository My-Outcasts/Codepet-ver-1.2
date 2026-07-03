// Shared brief → company-context composer. Turns a persisted CompanyBrief (the
// onboarding answers) into a single plain-language paragraph that byte writes
// from. Used by both /api/run-task (per-deliverable generation) and
// /api/personalize (one-time seed templating) so the company is described the
// same way everywhere. Pure + dependency-free so it runs server-side.

/**
 * Compose the user's persisted onboarding brief into company context so byte
 * writes from their real company. Returns null when there's no usable signal
 * (no name / one-liner / notes), so callers can fall back to a baseline.
 */
export function briefToContext(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const name = str(b.projectName, 120);
  const oneLiner = str(b.oneLiner, 240);
  const notes = str(b.notes, 800);
  const categories = Array.isArray(b.categories)
    ? b.categories.filter((c): c is string => typeof c === 'string').slice(0, 6)
    : [];
  const audience = str(b.audience, 160);
  const link = str(b.link, 200);
  if (!name && !oneLiner && !notes) return null;

  const parts: string[] = [`The company is ${name || "the founder's product"}.`];
  if (oneLiner) parts.push(oneLiner.endsWith('.') ? oneLiner : `${oneLiner}.`);
  if (categories.length) parts.push(`It is a ${categories.join(' / ').toLowerCase()} product.`);
  if (audience) parts.push(`It's for ${audience}.`);
  if (notes) parts.push(notes.endsWith('.') ? notes : `${notes}.`);
  if (link) parts.push(`Reference: ${link}.`);
  const who: string[] = [];
  const role = str(b.role, 80);
  const stage = str(b.stage, 80);
  if (role) who.push(`a ${role.toLowerCase()}`);
  if (stage) who.push(`at the ${stage.toLowerCase()} stage`);
  if (who.length) parts.push(`The founder is ${who.join(', ')}.`);
  const founderName = str(b.founderName, 80);
  if (founderName) parts.push(`Their name is ${founderName}.`);
  return parts.join(' ');
}
