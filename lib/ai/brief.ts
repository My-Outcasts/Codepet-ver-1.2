// Shared brief → company-context composer. Turns a persisted CompanyBrief (the
// onboarding answers) into a single plain-language paragraph that byte writes
// from. Used by both /api/run-task (per-deliverable generation) and
// /api/personalize (one-time seed templating) so the company is described the
// same way everywhere. Pure + dependency-free so it runs server-side.
import { cleanCompanyName } from '../companyName';

/**
 * Compose the user's persisted onboarding brief into company context so byte
 * writes from their real company. Returns null when there's no usable signal
 * (no name / one-liner / notes), so callers can fall back to a baseline.
 */
export function briefToContext(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  // Drop a junk name (raw email, all-digits) so byte is never told the company IS the email.
  const name = cleanCompanyName(str(b.projectName, 120)) ?? '';
  const oneLiner = str(b.oneLiner, 240);
  const summary = str(b.summary, 400);
  const notes = str(b.notes, 800);
  const categories = Array.isArray(b.categories)
    ? b.categories.filter((c): c is string => typeof c === 'string').slice(0, 6)
    : [];
  const audience = str(b.audience, 160);
  const link = str(b.link, 200);
  // byte's first-chat enrichment — the three plan-shaping signals onboarding never asks for.
  // These are what make a plan tailored instead of generic; when present, they're the
  // highest-value context byte has (see lib/ai/enrichInterview).
  const goal = str(b.goal, 400);
  const traction = str(b.traction, 400);
  const problem = str(b.problem, 400);
  if (!name && !oneLiner && !summary && !notes) return null;

  const parts: string[] = [`The company is ${name || "the founder's product"}.`];
  // One product description, not three. byte's enriched `summary` is a distillation of the
  // one-liner + notes, so when it exists it REPLACES both (avoids repeating the same
  // description ~3x on every prompt). Without a summary, fall back to the one-liner and the
  // raw notes the founder pasted.
  const dot = (s: string) => (s.endsWith('.') ? s : `${s}.`);
  if (summary) {
    parts.push(dot(summary));
  } else if (oneLiner) {
    parts.push(dot(oneLiner));
  }
  if (categories.length) parts.push(`It is a ${categories.join(' / ').toLowerCase()} product.`);
  if (audience) parts.push(`It's for ${audience}.`);
  if (notes && !summary) parts.push(dot(notes));
  if (link) parts.push(`Reference: ${link}.`);
  const who: string[] = [];
  const role = str(b.role, 80);
  const stage = str(b.stage, 80);
  if (role) who.push(`a ${role.toLowerCase()}`);
  if (stage) who.push(`at the ${stage.toLowerCase()} stage`);
  if (who.length) parts.push(`The founder is ${who.join(', ')}.`);
  const founderName = str(b.founderName, 80);
  if (founderName) parts.push(`Their name is ${founderName}.`);
  // The plan-shaping signals last — they're the sharpest steer for what byte should produce.
  if (problem) parts.push(`The problem it solves: ${dot(problem)}`);
  if (traction) parts.push(`Where they are now: ${dot(traction)}`);
  if (goal) parts.push(`Their immediate goal: ${dot(goal)}`);
  return parts.join(' ');
}
