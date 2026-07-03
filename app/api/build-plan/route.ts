// Build Coach — "generate a plan" step, made real. Takes the free-text brief
// (whatever the user wants to build) and asks Claude for a small,
// token-thrifty build plan. Mirrors app/api/run-task: ANTHROPIC_API_KEY stays
// server-side, the caller must present a valid Firebase ID token, and the reply
// is constrained to PLAN_SCHEMA via structured outputs. Node runtime so the SDK
// runs. See docs/superpowers/specs/2026-07-02-build-coach-view-design.md.
import Anthropic from '@anthropic-ai/sdk';
import { verifyIdToken } from '@/lib/firebase/admin';
import { sanitizePlanInput, buildPlanPrompt, PLAN_SCHEMA, type BytePlan } from '@/lib/ai/plan';

export const runtime = 'nodejs';

const BYTE_SYSTEM = `You are Byte, the warm, encouraging building companion inside Codepet. You help a "vibe-coder" build features with an AI coding agent while spending as few tokens as possible.

Voice: warm, plain-language, concrete, lightly playful. Reply only with the requested plan — no preamble.`;

export async function POST(req: Request): Promise<Response> {
  // Paid API — require a valid Firebase ID token, same as /api/run-task.
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

  const input = sanitizePlanInput(body);
  if (!input) {
    return Response.json(
      { error: 'bad_request', message: 'brief is required.' },
      { status: 400 },
    );
  }

  const client = new Anthropic({ apiKey });
  try {
    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema: PLAN_SCHEMA } },
      system: BYTE_SYSTEM,
      messages: [{ role: 'user', content: buildPlanPrompt(input) }],
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
      const plan = JSON.parse(text) as BytePlan;
      return Response.json({ plan });
    } catch {
      console.error('[build-plan] structured output was not valid JSON');
      return Response.json({ error: 'parse_failed' }, { status: 502 });
    }
  } catch (err) {
    console.error('[build-plan] generation failed', err);
    const status = err instanceof Anthropic.APIError ? (err.status ?? 502) : 502;
    return Response.json({ error: 'generation_failed' }, { status });
  }
}
