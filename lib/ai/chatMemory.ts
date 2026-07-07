// Chat → durable memory, the ZERO-EXTRA-COST way. Rather than a second model call per
// message, byte captures durable facts via a `remember_fact` TOOL it can call in the SAME
// chat generation it uses to reply (see app/api/chat/route.ts) — so there's no extra API
// request. This module holds the pure, unit-tested parts: the tool's input schema, coercion
// of its (untrusted) input into decision entries, and the new-or-changed diff that decides
// which captures surface as "Noted" chips. Merge + persistence reuse the decisions layer
// (mergeDecisions / writeServerDecisions) and composeProjectModel grounds every later call.
import type { DecisionEntry } from './projectModel';
import type { ExtractedDecision } from './decisions';

/** One captured fact, surfaced to the client as a "Noted" chip. */
export interface CapturedMemory {
  topic: string;
  statement: string;
}

/** Input schema for byte's `remember_fact` tool. byte fills this in-line when the founder
 *  states something durable, alongside its normal reply — no separate extraction call. */
export const REMEMBER_FACT_SCHEMA: Record<string, unknown> = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    facts: {
      type: 'array',
      description:
        'The durable decisions or material facts the founder just stated about their company. Empty if the message states none.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          topic: {
            type: 'string',
            description:
              'A short lowercase key for the area, e.g. traction, goal, milestone, pricing, positioning, naming, audience, tech, scope, timeline. Reuse an existing topic when this UPDATES it.',
          },
          statement: {
            type: 'string',
            description:
              'One concrete sentence in the founder\'s terms with their real numbers exact (e.g. "~300 people on the waitlist"). Never invent or embellish.',
          },
        },
        required: ['topic', 'statement'],
      },
    },
  },
  required: ['facts'],
};

const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/**
 * Coerce the (untrusted) `remember_fact` tool input into clean decision entries. Drops any
 * item missing a topic or statement; caps lengths. `source` is stamped 'chat'.
 */
export function coerceMemory(input: unknown): ExtractedDecision[] {
  const facts = (input as { facts?: unknown })?.facts;
  if (!Array.isArray(facts)) return [];
  const out: ExtractedDecision[] = [];
  for (const f of facts) {
    const topic = str((f as { topic?: unknown })?.topic, 40).toLowerCase();
    const statement = str((f as { statement?: unknown })?.statement, 600);
    if (topic && statement) out.push({ topic, statement, source: 'chat' });
  }
  return out;
}

const key = (t: string) => t.trim().toLowerCase();

/**
 * Which coerced facts are genuinely NEW or CHANGED vs. what's already on record — the ones
 * worth a "Noted" chip. An unchanged repeat of an existing fact yields nothing.
 */
export function newOrChanged(
  existing: DecisionEntry[],
  facts: ExtractedDecision[],
): CapturedMemory[] {
  const before = new Map(existing.map((d) => [key(d.topic), d.statement.trim()]));
  const seen = new Set<string>();
  const out: CapturedMemory[] = [];
  for (const f of facts) {
    const k = key(f.topic);
    if (seen.has(k)) continue; // de-dup within one message
    seen.add(k);
    if (before.get(k) !== f.statement.trim()) out.push({ topic: f.topic, statement: f.statement });
  }
  return out;
}
