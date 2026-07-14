// Byte's brainstorm step — the adaptive Q&A before a plan. Takes the running
// intake conversation and returns Byte's next move (another question, or a
// reflect-back "ready" summary). Mirrors app/api/build-plan: ANTHROPIC_API_KEY
// stays server-side, the caller must present a valid Firebase ID token, and the
// reply is constrained to BRAINSTORM_SCHEMA via structured outputs. Node runtime.
// See docs/superpowers/specs/2026-07-14-byte-brainstorm-lets-build-design.md.
import Anthropic from '@anthropic-ai/sdk';
import { verifyIdToken } from '@/lib/firebase/admin';
import {
  sanitizeBrainstormInput,
  buildBrainstormPrompt,
  BRAINSTORM_SCHEMA,
  type BrainstormReply,
} from '@/lib/ai/brainstorm';

export const runtime = 'nodejs';

const BYTE_BRAINSTORM_SYSTEM = `You are Byte, the warm, encouraging building companion inside Codepet. Before building a feature, you brainstorm with a "vibe-coder" to understand what they want.

Ask ONE short, targeted question at a time (who it's for, the core problem, scope, what "done" looks like). Ask at most 3 questions total, then reflect back what you'll build for them to confirm. Voice: warm, plain-language, concrete, lightly playful. Reply only with the requested JSON — no preamble.`;

export async function POST(req: Request): Promise<Response> {
  // Paid API — require a valid Firebase ID token, same as /api/build-plan.
  const authz = req.headers.get('authorization') ?? '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  if (!idToken) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    await verifyIdToken(idToken);
  } catch {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'not_configured', message: 'ANTHROPIC_API_KEY is not set on the server.' },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const input = sanitizeBrainstormInput(body);
  if (!input) {
    return Response.json(
      { error: 'bad_request', message: 'conversation is required.' },
      { status: 400 },
    );
  }

  const client = new Anthropic({ apiKey });
  try {
    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 512,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema: BRAINSTORM_SCHEMA } },
      system: BYTE_BRAINSTORM_SYSTEM,
      messages: [{ role: 'user', content: buildBrainstormPrompt(input) }],
    });

    if (message.stop_reason === 'refusal') {
      return Response.json({ error: 'refused' }, { status: 422 });
    }

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    if (!text) {
      return Response.json({ error: 'empty' }, { status: 502 });
    }

    try {
      const reply = JSON.parse(text) as BrainstormReply;
      return Response.json({ reply });
    } catch {
      console.error('[build-brainstorm] structured output was not valid JSON');
      return Response.json({ error: 'parse_failed' }, { status: 502 });
    }
  } catch (err) {
    console.error('[build-brainstorm] generation failed', err);
    const status = err instanceof Anthropic.APIError ? (err.status ?? 502) : 502;
    return Response.json({ error: 'generation_failed' }, { status });
  }
}
