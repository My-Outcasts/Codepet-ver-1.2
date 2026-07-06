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

/**
 * Normalized token usage for one model call. The client produces this shape (it owns
 * it); a route can pass an `onUsage` sink to persist it (see lib/firebase/serverUsage).
 * Keeping the type here means the client never imports Firebase — the dependency runs
 * the other way (the sink imports this type).
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

function toTokenUsage(usage: Anthropic.Usage | null | undefined): TokenUsage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
  };
}

// Canonical failure kinds a generation can end in. Routes translate these to their
// own error codes via aiErrorResponse() so the public API contract is unchanged.
// `billing` is split out from `upstream` so a credit/quota outage is named — the exact
// blindside we hit — instead of a vague 502.
type Failure =
  | { kind: 'not_configured' }
  | { kind: 'refused' }
  | { kind: 'empty' }
  | { kind: 'parse_failed' }
  | { kind: 'billing' }
  | { kind: 'upstream'; status: number };

/**
 * Classify an upstream API error into a failure kind from its status + message. A 400/402
 * whose message names a credit/quota/billing problem is `billing` (Anthropic returns 400
 * "Your credit balance is too low…" when the org runs out); everything else is `upstream`.
 * Pure + exported so it's unit-tested against the real messages.
 */
export function classifyFailureKind(status: number, message: string): 'billing' | 'upstream' {
  if (
    (status === 400 || status === 402) &&
    /credit balance|billing|insufficient|quota/i.test(message)
  ) {
    return 'billing';
  }
  return 'upstream';
}

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
  model: string,
  startedAt: number,
  usage: Anthropic.Usage | null | undefined,
  stopReason: string | null,
): void {
  const ms = Date.now() - startedAt;
  console.info(
    `[ai] label=${label} model=${model} ms=${ms} ` +
      `in=${usage?.input_tokens ?? 0} out=${usage?.output_tokens ?? 0} ` +
      `cache_read=${usage?.cache_read_input_tokens ?? 0} ` +
      `cache_write=${usage?.cache_creation_input_tokens ?? 0} stop=${stopReason ?? '?'}`,
  );
}

// One structured, greppable line per FAILED model call — the counterpart to logUsage. A
// credit outage becomes `grep 'FAILURE kind=billing'` instead of a buried stack trace; a
// log drain can alert on it. Emitted on both the non-streaming and streaming paths.
function logFailure(label: string, kind: string, status: number): void {
  console.error(`[ai] label=${label} FAILURE kind=${kind} status=${status}`);
}

// Prompt caching. byte re-sends a large, stable prefix on every call — the system prompt
// (which carries the whole project model) and, in chat, the tool set. Marking that prefix
// `cache_control: ephemeral` bills it at ~10% on a cache hit within the 5-min TTL. Below the
// model's minimum cacheable size (~1024 tokens) the API simply doesn't cache it, so tagging
// a short system (enrich / next-step) is harmless. Hit-rate shows up in the [ai] log's
// cache_read/cache_write and in onUsage. One place — see the header note.
const CACHE: Anthropic.CacheControlEphemeral = { type: 'ephemeral' };

function cachedSystem(system: string): Anthropic.TextBlockParam[] {
  return [{ type: 'text', text: system, cache_control: CACHE }];
}

/** Mark the tool set cacheable by tagging the last tool (cache_control applies to the whole
 *  prefix up to and including it). No-op when there are no tools. */
function cacheTools(
  tools: Anthropic.MessageCreateParams['tools'],
): Anthropic.MessageCreateParams['tools'] {
  if (!tools?.length) return tools;
  const last = tools.length - 1;
  return tools.map((t, i) => (i === last ? { ...t, cache_control: CACHE } : t));
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
  /** Model override. Defaults to MODEL (Opus 4.8). Use a cheaper tier for simple work
   *  like decision extraction — must be an adaptive-thinking + effort model (Sonnet 5+). */
  model?: string;
  /** Optional sink for this call's token usage (e.g. persist per-user daily totals). */
  onUsage?: (usage: TokenUsage) => void;
}

/**
 * Run a non-streaming message and return the assistant's trimmed text. Handles refusal
 * and empty output (throws GenerationError), logs usage, and normalizes upstream errors.
 */
export async function generateText(opts: GenerateOptions): Promise<string> {
  const messages = opts.messages ?? [{ role: 'user' as const, content: opts.prompt ?? '' }];
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: opts.model ?? MODEL,
    max_tokens: opts.maxTokens,
    thinking: { type: 'adaptive' },
    output_config: opts.schema
      ? { effort: opts.effort ?? 'low', format: { type: 'json_schema', schema: opts.schema } }
      : { effort: opts.effort ?? 'low' },
    system: cachedSystem(opts.system),
    messages,
  };

  const startedAt = Date.now();
  let message: Anthropic.Message;
  try {
    message = await opts.client.messages.create(params);
  } catch (err) {
    const status = err instanceof Anthropic.APIError ? (err.status ?? 502) : 502;
    const errMessage = err instanceof Anthropic.APIError ? (err.message ?? '') : String(err);
    const kind = classifyFailureKind(status, errMessage);
    logFailure(opts.label, kind, status);
    throw new GenerationError(
      kind === 'billing' ? { kind: 'billing' } : { kind: 'upstream', status },
    );
  }

  logUsage(opts.label, params.model, startedAt, message.usage, message.stop_reason);
  opts.onUsage?.(toTokenUsage(message.usage));

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
  /** Optional sink for this call's token usage, fired when the stream completes. */
  onUsage?: (usage: TokenUsage) => void;
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
    system: cachedSystem(opts.system),
    messages: opts.messages,
    tools: cacheTools(opts.tools),
  });
  stream
    .finalMessage()
    .then((m) => {
      logUsage(opts.label, MODEL, startedAt, m.usage, m.stop_reason);
      opts.onUsage?.(toTokenUsage(m.usage));
    })
    .catch((err) => {
      // The route surfaces the error to the client; here we just emit the ops signal, so a
      // mid-stream credit outage is greppable on the chat path too (not only run-task).
      // A deliberate abort (sign-out / new send) isn't a real failure — skip it.
      if (err?.name === 'AbortError') return;
      const status = err instanceof Anthropic.APIError ? (err.status ?? 502) : 502;
      const msg = err instanceof Anthropic.APIError ? (err.message ?? '') : String(err);
      logFailure(opts.label, classifyFailureKind(status, msg), status);
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
      case 'billing':
        // The AI provider is out of credit/quota — an operator problem, not the caller's.
        // A distinct, honest 503 (not a vague 502) so clients can say "temporarily
        // unavailable" and it stands out in logs/metrics.
        return Response.json({ error: 'ai_unavailable' }, { status: 503 });
      case 'upstream':
        return Response.json({ error: fallbackCode }, { status: err.failure.status });
    }
  }
  return Response.json({ error: fallbackCode }, { status: 502 });
}
