// "byte reads it" made real. At onboarding the founder gives a one-liner and maybe
// pastes a pitch/README — but the high-signal fields (audience, categories, a sharp
// product summary) are optional and usually skipped, leaving byte to scaffold a company
// it barely knows. This turns whatever the founder DID provide into a richer structured
// brief: byte reads their inputs and fills the gaps, so the plan is tailored to the real
// product. Pure + dependency-free (schema/prompt/merge) so it unit-tests in plain node;
// the model call + persistence live in /api/scaffold.
import type { CompanyBrief } from '../firebase/schema';

/** byte's structured read of the founder's product. */
export interface BriefEnrichment {
  summary: string;
  audience: string;
  categories: string[];
}

export const ENRICH_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: {
      type: 'string',
      description:
        'A sharp 1-2 sentence description of what the product is and does, in plain language — grounded ONLY in what the founder said.',
    },
    audience: {
      type: 'string',
      description:
        "Who the product is for (the target user or customer), inferred from the founder's input. Empty string if you genuinely cannot tell.",
    },
    categories: {
      type: 'array',
      items: { type: 'string' },
      description:
        '2-4 short product categories (e.g. "macOS app", "dev tool", "SaaS"). Empty array if unclear.',
    },
  },
  required: ['summary', 'audience', 'categories'],
};

/** Only worth a model call when the founder gave byte something to read. */
export function hasEnrichableSignal(brief: CompanyBrief): boolean {
  return !!(brief.oneLiner?.trim() || brief.notes?.trim());
}

const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/** Build the prompt that asks byte to read the founder's inputs into a structured brief. */
export function buildEnrichPrompt(brief: CompanyBrief): string {
  const lines = [
    `Product name: ${clip(brief.projectName, 120) || '(unnamed)'}`,
    brief.oneLiner ? `Founder's one-liner: ${clip(brief.oneLiner, 300)}` : null,
    brief.categories?.length ? `Founder-picked categories: ${brief.categories.join(', ')}` : null,
    brief.audience ? `Founder-stated audience: ${clip(brief.audience, 200)}` : null,
    brief.link ? `Link: ${clip(brief.link, 200)}` : null,
    brief.notes ? `Founder's notes / pitch:\n${clip(brief.notes, 2000)}` : null,
  ].filter(Boolean);
  return (
    'Read what the founder told you about their product and produce a crisp structured read of it.\n\n' +
    lines.join('\n') +
    "\n\nProduce: a sharp 1-2 sentence summary of what it is and does; who it's for (audience); and 2-4 product categories. Ground EVERYTHING only in what the founder said — do not invent features, an audience, or a different product. If you genuinely can't infer a field, use an empty string / empty array rather than guessing."
  );
}

/**
 * Merge byte's read into the brief WITHOUT overriding what the founder explicitly typed:
 * founder-provided audience/categories win; byte only fills the gaps and adds its summary.
 */
export function mergeEnrichment(brief: CompanyBrief, e: BriefEnrichment): CompanyBrief {
  const summary = clip(e.summary, 400);
  const audience = clip(e.audience, 200);
  const cats = Array.isArray(e.categories)
    ? e.categories
        .map((c) => clip(c, 40))
        .filter(Boolean)
        .slice(0, 4)
    : [];
  return {
    ...brief,
    summary: summary || brief.summary,
    audience: brief.audience?.trim() ? brief.audience : audience || brief.audience,
    categories: brief.categories?.length ? brief.categories : cats.length ? cats : brief.categories,
  };
}
