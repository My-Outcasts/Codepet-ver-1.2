// Chat → durable memory. The decisions layer (decisions.ts + /api/remember) only mines
// APPROVED DELIVERABLES; the high-signal things a founder says in passing ("waitlist's at
// 300", "we're dropping the free tier") never reach the memory that grounds generation, so
// byte forgets them. This module is the pure, unit-tested half of closing that gap: a cheap
// substance GATE (so we don't spend a model call on "thanks" / "run that"), plus the
// extraction schema + prompt for pulling durable decisions OR material facts out of one
// founder message. It emits ExtractedDecision[] so the SAME mergeDecisions/writeServerDecisions
// path persists it and composeProjectModel grounds every later chat + run-task call.
// The model call + persistence live in /api/remember-chat.
import type { DecisionEntry } from './projectModel';

/** Minimum length for a message to be worth an extraction call. */
const MIN_LEN = 16;

// Openers that mark a message as a task command or pure question to byte, not a statement
// of fact about the company — cheap to reject before spending a model call. The extractor
// would return empty for these anyway; the gate just avoids the round-trip.
const COMMAND_OPENERS =
  /^(run|do|make|draft|write|build|create|open|show|go|start|revise|redo|generate|give me|can you|could you|please|what|how|why|when|where|who|should i|should we|is it|are we|help)\b/i;

/**
 * Cheap pre-filter: is this founder message plausibly worth mining for durable memory?
 * Rejects the obvious no-signal cases (too short, task commands, pure questions). Not
 * precise — the extractor is the real judge and returns empty when there's nothing — this
 * only spares wasteful model calls.
 */
export function worthExtracting(text: string): boolean {
  const t = text.trim();
  if (t.length < MIN_LEN) return false;
  if (COMMAND_OPENERS.test(t)) return false;
  // A bare question (no declarative clause) rarely states a durable fact.
  if (t.endsWith('?') && !/[.!]/.test(t)) return false;
  return true;
}

/** Structured-output schema for chat extraction — same shape as the deliverable extractor
 *  (so mergeDecisions consumes it), broadened from decisions to decisions + material facts. */
export const CHAT_MEMORY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    memory: {
      type: 'array',
      description:
        'Durable decisions OR material facts about the company that the founder stated in this message. Empty array if the message states none (a question, request, opinion, or chit-chat).',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          topic: {
            type: 'string',
            description:
              'A short lowercase key for the area, e.g. traction, goal, milestone, pricing, positioning, naming, audience, tech, scope, timeline. Reuse an existing topic when this message UPDATES it (e.g. a new waitlist count updates "traction").',
          },
          statement: {
            type: 'string',
            description:
              'One concrete sentence capturing the decision or fact, in the founder\'s terms with their real numbers exact (e.g. "~300 people on the waitlist as of now"). Never invent or embellish.',
          },
          source: {
            type: 'string',
            description: 'Where it came from — use "chat" for a message the founder typed.',
          },
        },
        required: ['topic', 'statement'],
      },
    },
  },
  required: ['memory'],
};

/** Per-message text budget sent to the extractor. */
const MSG_CAP = 1200;

/**
 * Build the chat extraction prompt. Existing memory is shown so the model reuses a topic
 * when the message UPDATES it (e.g. traction count) and doesn't re-emit unchanged facts.
 */
export function buildChatExtractPrompt(message: string, existing: DecisionEntry[]): string {
  const onRecord = existing.length
    ? existing.map((d) => `- ${d.topic}: ${d.statement}`).join('\n')
    : '(none yet)';
  const msg = message.trim().replace(/\s+/g, ' ').slice(0, MSG_CAP);
  return [
    'Company memory already on record (reuse a topic only if this message UPDATES it; do not repeat unchanged facts):',
    onRecord,
    '',
    'The founder just said this in chat:',
    '---',
    msg,
    '---',
    'Extract only NEW or CHANGED durable decisions or material facts they stated about their company (traction, goals, milestones, pricing, positioning, naming, audience, tech, scope, timeline). Ground everything ONLY in what they said — never infer or invent. Ignore questions, requests to you, opinions, and small talk. If there is nothing durable, return an empty list.',
  ].join('\n');
}
