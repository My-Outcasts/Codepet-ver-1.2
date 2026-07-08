// Build Coach — the intake brainstorm step. Given the project scan + the
// founder's answers so far, Byte asks ONE short scan-grounded follow-up question
// (or says it has enough to plan). Mirrors app/api/build-plan: ANTHROPIC_API_KEY
// stays server-side, the caller must present a valid Firebase ID token, and the
// reply is constrained to INTAKE_SCHEMA via structured outputs.
// See docs/superpowers/specs/2026-07-08-build-intake-project-scan-design.md.
import Anthropic from '@anthropic-ai/sdk';
import { verifyIdToken } from '@/lib/firebase/admin';
import {
  sanitizeIntakeInput,
  intakePrompt,
  INTAKE_SCHEMA,
  type IntakeReply,
} from '@/lib/ai/intake';

export const runtime = 'nodejs';

const BYTE_SYSTEM = `You are Byte, the warm, encouraging building companion inside Codepet. You help a "vibe-coder" shape what to build before any code is written.

Voice: warm, plain-language, concrete, lightly playful. Reply only with the requested JSON — no preamble.`;

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

  const input = sanitizeIntakeInput(body);
  if (!input) {
    return Response.json(
      { error: 'bad_request', message: 'at least one turn is required.' },
      { status: 400 },
    );
  }

  const client = new Anthropic({ apiKey });
  try {
    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 512,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema: INTAKE_SCHEMA } },
      system: BYTE_SYSTEM,
      messages: [{ role: 'user', content: intakePrompt(input) }],
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
      const reply = JSON.parse(text) as IntakeReply;
      return Response.json({ reply });
    } catch {
      console.error('[build-intake] structured output was not valid JSON');
      return Response.json({ error: 'parse_failed' }, { status: 502 });
    }
  } catch (err) {
    console.error('[build-intake] generation failed', err);
    const status = err instanceof Anthropic.APIError ? (err.status ?? 502) : 502;
    return Response.json({ error: 'generation_failed' }, { status });
  }
}
