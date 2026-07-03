// The one place byte talks to Claude. Every /api/* route that calls the model goes
// through here instead of constructing its own `new Anthropic(...)`, so the model id,
// thinking/effort defaults, retry policy, refusal handling, text extraction, usage
// logging, and error→HTTP mapping live in a single seam. Change the model or add
// prompt caching once, here — not in five routes.
//
// Server-only (holds ANTHROPIC_API_KEY). Import from Node-runtime route handlers.
import Anthropic from '@anthropic-ai/sdk';

/** The model every byte call uses. One constant so a bump/A-B is a one-line change. */
export const MODEL = 'claude-opus-4-8';

/** Effort levels byte uses; all current routes run `low` (cheap, structured work). */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

// Canonical failure kinds a generation can end in. Routes translate these to their
// own error codes via aiErrorResponse() so the public API contract is unchanged.
type Failure =
  | { kind: 'not_configured' }
  | { kind: 'refused' }
  | { kind: 'empty' }
  | { kind: 'parse_failed' }
  | { kind: 'upstream'; status: number };

/** Thrown by getClient()/generate* so a route's catch can map it to a Response. */
export class GenerationError extends Error {
  constructor(readonly failure: Failure) {
    super(failure.kind);
    this.name = 'GenerationError';
  }
}

// Reuse one client across warm invocations (module scope survives per-lambda). Retry
// 429/5xx/connection errors a little harder than the SDK default (2) since these are
// user-facing generations. Add timeout/base_url here if ever needed.
let client: Anthropic | null = null;

/**
 * Return the shared Anthropic client, or throw GenerationError('not_configured') if the
 * key is missing. Call this early in a route (where the old `if (!apiKey)` gate was) so
 * the missing-key exit happens before any brief load or usage-counter write.
 */
export function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new GenerationError({ kind: 'not_configured' });
  if (!client) client = new Anthropic({ apiKey, maxRetries: 3 });
  return client;
}

// One structured log line per model call — the seam for real observability later
// (route, model, latency, tokens, cache hit-rate, stop reason). Cheap and greppable.
function logUsage(
  label: string,
  startedAt: number,
  usage: Anthropic.Usage | null | undefined,
  stopReason: string | null,
): void {
  const ms = Date.now() - startedAt;
  console.info(
    `[ai] label=${label} model=${MODEL} ms=${ms} ` +
      `in=${usage?.input_tokens ?? 0} out=${usage?.output_tokens ?? 0} ` +
      `cache_read=${usage?.cache_read_input_tokens ?? 0} ` +
      `cache_write=${usage?.cache_creation_input_tokens ?? 0} stop=${stopReason ?? '?'}`,
  );
}

function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/** A non-streaming generation. `prompt` is sugar for a single user turn. */
export interface GenerateOptions {
  client: Anthropic;
  system: string;
  /** Provide exactly one of `prompt` (single user turn) or `messages` (full history). */
  prompt?: string;
  messages?: Anthropic.MessageParam[];
  maxTokens: number;
  /** Route name, used in the usage log line. */
  label: string;
  /** Attach a JSON-schema output format (structured output). Omit/null for plain text. */
  schema?: Record<string, unknown> | null;
  /** Defaults to 'low' — the setting every current route uses. */
  effort?: Effort;
}

/**
 * Run a non-streaming message and return the assistant's trimmed text. Handles refusal
 * and empty output (throws GenerationError), logs usage, and normalizes upstream errors.
 */
export async function generateText(opts: GenerateOptions): Promise<string> {
  const messages = opts.messages ?? [{ role: 'user' as const, content: opts.prompt ?? '' }];
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: MODEL,
    max_tokens: opts.maxTokens,
    thinking: { type: 'adaptive' },
    output_config: opts.schema
      ? { effort: opts.effort ?? 'low', format: { type: 'json_schema', schema: opts.schema } }
      : { effort: opts.effort ?? 'low' },
    system: opts.system,
    messages,
  };

  const startedAt = Date.now();
  let message: Anthropic.Message;
  try {
    message = await opts.client.messages.create(params);
  } catch (err) {
    console.error(`[ai] label=${opts.label} generation failed`, err);
    const status = err instanceof Anthropic.APIError ? (err.status ?? 502) : 502;
    throw new GenerationError({ kind: 'upstream', status });
  }

  logUsage(opts.label, startedAt, message.usage, message.stop_reason);

  if (message.stop_reason === 'refusal') throw new GenerationError({ kind: 'refused' });
  const text = extractText(message);
  if (!text) throw new GenerationError({ kind: 'empty' });
  return text;
}

/**
 * Like generateText but parses the model's structured output as JSON. `schema` is
 * required. Throws GenerationError('parse_failed') if the output isn't valid JSON.
 */
export async function generateJson<T>(
  opts: GenerateOptions & { schema: Record<string, unknown> },
): Promise<T> {
  const text = await generateText(opts);
  try {
    return JSON.parse(text) as T;
  } catch {
    console.error(`[ai] label=${opts.label} structured output was not valid JSON`);
    throw new GenerationError({ kind: 'parse_failed' });
  }
}

export interface StreamOptions {
  client: Anthropic;
  system: string;
  messages: Anthropic.MessageParam[];
  maxTokens: number;
  label: string;
  effort?: Effort;
  /** Optional tool set (e.g. byte's run_task tool in chat). */
  tools?: Anthropic.MessageCreateParams['tools'];
}

/**
 * Start a streaming generation with the shared model config. Returns the SDK stream so
 * the caller keeps its own SSE/ReadableStream plumbing; usage is logged in the
 * background when the message completes. The return type is the SDK's own
 * MessageStream (inferred), so callers keep full type information on the events.
 */
export function streamMessage(opts: StreamOptions) {
  const startedAt = Date.now();
  const stream = opts.client.messages.stream({
    model: MODEL,
    max_tokens: opts.maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort: opts.effort ?? 'low' },
    system: opts.system,
    messages: opts.messages,
    tools: opts.tools,
  });
  stream
    .finalMessage()
    .then((m) => logUsage(opts.label, startedAt, m.usage, m.stop_reason))
    .catch(() => {
      /* aborted or errored mid-stream — the route surfaces the error to the client */
    });
  return stream;
}

/**
 * Map a thrown GenerationError to the HTTP Response each route returns. Canonical
 * failures keep their existing codes/statuses; an upstream/unknown error uses the
 * caller's `fallbackCode` (e.g. 'pick_failed', 'scaffold_failed', 'generation_failed')
 * so the public error contract is unchanged.
 */
export function aiErrorResponse(err: unknown, fallbackCode: string): Response {
  if (err instanceof GenerationError) {
    switch (err.failure.kind) {
      case 'not_configured':
        return Response.json(
          { error: 'not_configured', message: 'ANTHROPIC_API_KEY is not set on the server.' },
          { status: 503 },
        );
      case 'refused':
        return Response.json({ error: 'refused' }, { status: 422 });
      case 'empty':
        return Response.json({ error: 'empty' }, { status: 502 });
      case 'parse_failed':
        return Response.json({ error: 'parse_failed' }, { status: 502 });
      case 'upstream':
        return Response.json({ error: fallbackCode }, { status: err.failure.status });
    }
  }
  return Response.json({ error: fallbackCode }, { status: 502 });
}
