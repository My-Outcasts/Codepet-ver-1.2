// Write side of the decisions layer (Phase 2). When the founder approves a deliverable,
// byte extracts any durable decision it locks in and merges it into the company memory
// that projectModel.ts reads. This module holds the pure, unit-tested parts — the
// extraction schema, the prompt, and the merge — with no Firestore or network. The
// server route (/api/remember) makes the model call and persists via serverDecisions.
import type { DecisionEntry } from './projectModel';
import { MAX_DECISIONS } from './projectModel';

/** One decision as returned by the extraction model (no timestamp yet). */
export interface ExtractedDecision {
  topic: string;
  statement: string;
  source?: string;
}

/** Structured-output schema for the extraction call. */
export const DECISIONS_EXTRACT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    decisions: {
      type: 'array',
      description:
        'New or changed durable decisions this deliverable locks in. Empty array if none.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          topic: {
            type: 'string',
            description:
              'A short lowercase key for the decision area, e.g. pricing, positioning, naming, audience, tech, brand-voice, scope. Reuse an existing topic when the deliverable changes it.',
          },
          statement: {
            type: 'string',
            description: 'One concrete sentence stating the decision (e.g. "Plus tier is $4/mo").',
          },
          source: {
            type: 'string',
            description: 'Where it came from — usually the deliverable title and department.',
          },
        },
        required: ['topic', 'statement'],
      },
    },
  },
  required: ['decisions'],
};

/** The approved deliverable's high-signal fields, passed to extraction. */
export interface ApprovedDeliverable {
  title: string;
  dept: string;
  type: string;
  out: string;
}

/** Per-deliverable text budget sent to the extractor. */
const OUT_CAP = 2000;

/**
 * Build the extraction prompt. Existing decisions are shown so the model reuses a topic
 * when the deliverable *changes* one, and doesn't re-emit unchanged ones.
 */
export function buildExtractPrompt(
  deliverable: ApprovedDeliverable,
  existing: DecisionEntry[],
): string {
  const onRecord = existing.length
    ? existing.map((d) => `- ${d.topic}: ${d.statement}`).join('\n')
    : '(none yet)';
  const out = deliverable.out.trim().replace(/\s+/g, ' ').slice(0, OUT_CAP);
  return [
    'Decisions already on record (reuse a topic only if this deliverable CHANGES it; do not repeat unchanged ones):',
    onRecord,
    '',
    'The founder just approved this deliverable:',
    `Title: ${deliverable.title}`,
    `Department: ${deliverable.dept}`,
    `Type: ${deliverable.type}`,
    '---',
    out,
    '---',
    'Extract only NEW or CHANGED durable decisions it locks in. If there are none, return an empty list.',
  ].join('\n');
}

const key = (topic: string) => topic.trim().toLowerCase();

/**
 * Merge freshly-extracted decisions into the existing set, keyed by topic: an extracted
 * decision replaces the existing one on the same topic (case-insensitive) and stamps
 * `updatedAt = now`; existing decisions on untouched topics are preserved. Over the cap,
 * keep the most recently updated. Pure and order-stable (existing order, updates in
 * place, new topics appended) except when the cap forces a recency sort.
 */
export function mergeDecisions(
  existing: DecisionEntry[],
  extracted: ExtractedDecision[],
  now: number,
  max = MAX_DECISIONS,
): DecisionEntry[] {
  const byTopic = new Map<string, DecisionEntry>();
  for (const d of existing) {
    if (d.topic.trim() && d.statement.trim()) byTopic.set(key(d.topic), d);
  }
  for (const e of extracted) {
    const topic = (e.topic ?? '').trim();
    const statement = (e.statement ?? '').trim();
    if (!topic || !statement) continue;
    byTopic.set(key(topic), {
      topic,
      statement,
      source: e.source?.trim() || undefined,
      updatedAt: now,
    });
  }
  const merged = [...byTopic.values()];
  if (merged.length <= max) return merged;
  return [...merged].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, max);
}
