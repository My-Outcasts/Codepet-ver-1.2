'use server';
// Server side of the Research view: one model call that turns the founder's company
// brief into byte's deep research overview (summary / findings / sources / next steps).
// Prompt, schema, and validation live in lib/ai/researchOverview (pure, tested); this
// action only wires them to the shared Anthropic client seam. Returns a plain result
// object (not a thrown error) so the client view can render a friendly failure state.
import { getClient, generateJson, GenerationError } from '@/lib/ai/client';
import {
  RESEARCH_SYSTEM,
  RESEARCH_SCHEMA,
  researchPrompt,
  parseResearchOverview,
  type ResearchOverview,
} from '@/lib/ai/researchOverview';

export type ResearchResult =
  | { ok: true; overview: ResearchOverview }
  | { ok: false; error: string };

/**
 * Generate the research overview from the founder's brief context (the string
 * briefToContext() builds client-side). Errors come back as { ok: false, error }
 * with the client seam's failure kind ('not_configured', 'billing', 'refused', …).
 */
export async function generateResearchOverview(context: string): Promise<ResearchResult> {
  const ctx = typeof context === 'string' ? context.trim().slice(0, 2000) : '';
  if (!ctx) return { ok: false, error: 'no_brief' };

  let client: ReturnType<typeof getClient>;
  try {
    client = getClient();
  } catch {
    return { ok: false, error: 'not_configured' };
  }

  try {
    const raw = await generateJson<unknown>({
      client,
      system: RESEARCH_SYSTEM,
      prompt: researchPrompt(ctx),
      maxTokens: 2048,
      label: 'research-overview',
      schema: RESEARCH_SCHEMA,
    });
    const overview = parseResearchOverview(raw);
    if (!overview) return { ok: false, error: 'parse_failed' };
    return { ok: true, overview };
  } catch (err) {
    return { ok: false, error: err instanceof GenerationError ? err.failure.kind : 'upstream' };
  }
}
