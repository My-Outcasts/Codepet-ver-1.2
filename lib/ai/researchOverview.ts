// byte's "deep research overview" — the prompt, output schema, and response
// validation for the Research view. Pure module (no SDK import) so it's unit-testable;
// the model call itself lives in app/actions/research.ts via lib/ai/client.
//
// The overview surfaces four things about the founder's product:
//   1. summary    — byte's 2–3 sentence read of the product and its market
//   2. findings   — the handful of facts/risks/opportunities that matter most
//   3. sources    — well-known places to dig deeper (byte must not invent deep links)
//   4. nextSteps  — what the founder should actually do with the research

export interface ResearchSource {
  name: string;
  /** http(s) URL of a well-known site, or '' when the model gave none/an unsafe one. */
  url: string;
  why: string;
}

export interface ResearchOverview {
  summary: string;
  findings: string[];
  sources: ResearchSource[];
  nextSteps: string[];
}

export const MAX_FINDINGS = 5;
export const MAX_SOURCES = 5;
export const MAX_NEXT_STEPS = 3;

export const RESEARCH_SYSTEM = `You are byte, the AI operator inside Codepet, helping a solo founder build their company. Write a short market research overview of THEIR product: what space it plays in, who else is there, and what that means for them.

Be concrete and plain-spoken — no filler, no hedging boilerplate. For sources, only name well-known, real websites or publications (e.g. Crunchbase, Product Hunt, a major industry report site) with their homepage or a stable top-level URL. Never invent specific article links. Next steps must be things a solo founder can do this week.`;

export const RESEARCH_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: {
      type: 'string',
      description: "2-3 plain sentences: byte's read of the product, its market, and the founder's angle.",
    },
    findings: {
      type: 'array',
      description: `3-${MAX_FINDINGS} key findings — the facts, risks, or opportunities that matter most. One sentence each.`,
      items: { type: 'string' },
    },
    sources: {
      type: 'array',
      description: `2-${MAX_SOURCES} well-known places to research further. Real sites only; homepage/top-level URLs only.`,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: 'Site or publication name.' },
          url: { type: 'string', description: 'Its homepage or stable top-level https URL.' },
          why: { type: 'string', description: 'One sentence: what to look for there.' },
        },
        required: ['name', 'url', 'why'],
      },
    },
    nextSteps: {
      type: 'array',
      description: `2-${MAX_NEXT_STEPS} concrete next steps the founder should take based on this research.`,
      items: { type: 'string' },
    },
  },
  required: ['summary', 'findings', 'sources', 'nextSteps'],
};

export function researchPrompt(context: string): string {
  return `${context}\n\nWrite the deep research overview for this founder: the summary, key findings, key sources to explore, and suggested next steps.`;
}

const str = (v: unknown, cap: number): string =>
  typeof v === 'string' ? v.trim().slice(0, cap) : '';

const strList = (v: unknown, cap: number, max: number): string[] =>
  Array.isArray(v)
    ? v
        .map((x) => str(x, cap))
        .filter(Boolean)
        .slice(0, max)
    : [];

/** Keep only http(s) URLs — anything else (javascript:, ftp:, relative) becomes ''. */
function safeUrl(v: unknown): string {
  const u = str(v, 300);
  return /^https?:\/\//i.test(u) ? u : '';
}

/**
 * Validate + normalize the model's structured output into a ResearchOverview.
 * Malformed list entries are dropped rather than failing the whole response;
 * returns null only when there's no usable summary.
 */
export function parseResearchOverview(raw: unknown): ResearchOverview | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const summary = str(o.summary, 600);
  if (!summary) return null;

  const sources: ResearchSource[] = Array.isArray(o.sources)
    ? o.sources
        .map((s) => {
          const src = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
          return { name: str(src.name, 120), url: safeUrl(src.url), why: str(src.why, 240) };
        })
        .filter((s) => s.name.length > 0)
        .slice(0, MAX_SOURCES)
    : [];

  return {
    summary,
    findings: strList(o.findings, 300, MAX_FINDINGS),
    sources,
    nextSteps: strList(o.nextSteps, 300, MAX_NEXT_STEPS),
  };
}
