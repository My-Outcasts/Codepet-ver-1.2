// Shared server-side grounding loader. Composes the SAME project model that chat and
// run-task ground on — brief narrative + locked-in decisions (+ an optional shipped
// digest) — so the lighter generation routes (next-step, roadmap) stop grounding on the
// brief alone and no longer contradict decisions the founder has already locked in.
//
// Fail-open by construction: the underlying loaders return empty on any error, so a
// misconfig just yields thinner grounding and generation still proceeds. Server-only.
import { loadServerCompany } from '@/lib/firebase/serverCompany';
import { loadServerLibrary } from '@/lib/firebase/serverLibrary';
import { briefToContext } from '@/lib/ai/brief';
import { composeProjectModel } from '@/lib/ai/projectModel';
import type { PriorItem } from '@/lib/ai/priorWork';

export interface Grounding {
  /**
   * The full composed grounding string: brief narrative + decisions [+ shipped digest].
   * Empty when there is nothing to ground on; callers apply their own fallback.
   */
  context: string;
  /** The raw persisted brief, for stage extraction (never re-parse the composed string). */
  brief: unknown;
  /**
   * True only when a real brief narrative exists (persisted or client fallback). Routes
   * that must not invent a company from decisions alone should gate on THIS, not `context`
   * — composeProjectModel can emit a decisions block even with no brief.
   */
  hasBrief: boolean;
}

export interface GroundingOptions {
  /** Also load approved deliverables for the shipped-work digest (one extra read). */
  withShipped?: boolean;
  /** A client-passed brief to fall back on mid-onboarding, before the read settles. */
  fallbackBrief?: unknown;
}

/** Load brief + decisions (+ optionally shipped work) and compose the project model. */
export async function loadGrounding(
  uid: string,
  idToken: string,
  opts: GroundingOptions = {},
): Promise<Grounding> {
  const [company, shipped] = await Promise.all([
    loadServerCompany(uid, idToken),
    opts.withShipped ? loadServerLibrary(uid, idToken) : Promise.resolve([] as PriorItem[]),
  ]);
  const context = composeProjectModel({
    brief: company.brief,
    fallbackBrief: opts.fallbackBrief,
    decisions: company.decisions,
    shipped,
  });
  const hasBrief = Boolean(briefToContext(company.brief) ?? briefToContext(opts.fallbackBrief));
  return { context, brief: company.brief, hasBrief };
}
