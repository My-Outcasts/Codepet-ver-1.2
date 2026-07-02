// byte's conversational chat, made real (Phase 5.4 byte-chat). Streams a reply from
// the Claude API, grounded in the signed-in account's company: the brief is loaded
// server-side by the VERIFIED uid (never trusted from the client), and a compact
// department snapshot is passed as context so byte can talk about what's actually on
// the founder's plate. ANTHROPIC_API_KEY stays server-side; Node runtime for the SDK.
import Anthropic from '@anthropic-ai/sdk';
import { verifyIdToken } from '@/lib/firebase/admin';
import { briefToContext } from '@/lib/ai/brief';
import { loadServerBrief } from '@/lib/firebase/serverBrief';
import { enforceDailyLimit } from '@/lib/firebase/serverUsage';
import { toClaudeMessages, type ChatTurn } from '@/lib/ai/chatMessages';

export const runtime = 'nodejs';

const BYTE_SYSTEM = `You are byte, the AI building companion inside Codepet — a senior operator who helps a solo founder build and understand their whole company, department by department.

You are in a chat with the founder. Be warm, plain-spoken, specific, and brief — usually 2-4 sentences, occasionally a short list when it genuinely helps. No hype, no emoji, no filler. When they ask what to do next, ground your answer in their actual company and departments. You can outline and advise here; the founder runs real tasks from each department, where you produce the actual deliverables.

If the context names a CURRENT NEXT STEP, that is the founder's single agreed focus right now (it's what the map's beacon shows too). When they ask what to do next, lead with that exact task — you may add sequencing or detail, but never name a different task as the headline "next step," or the app will contradict itself.`;

const FALLBACK_CONTEXT =
  'The founder is building their company with Codepet but has not filled in a detailed brief yet — keep guidance general and invite them to tell you more.';

interface ChatBody {
  messages?: unknown;
  deptSummary?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  const authz = req.headers.get('authorization') ?? '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  if (!idToken) return Response.json({ error: 'unauthorized' }, { status: 401 });
  let uid: string;
  try {
    uid = (await verifyIdToken(idToken)).uid;
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

  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const turns: ChatTurn[] = Array.isArray(body.messages)
    ? (body.messages.filter(
        (m): m is ChatTurn =>
          !!m &&
          typeof m === 'object' &&
          (m as ChatTurn).role !== undefined &&
          typeof (m as ChatTurn).text === 'string',
      ) as ChatTurn[])
    : [];
  const claudeMessages = toClaudeMessages(turns).slice(-20); // cap history sent upstream
  if (!claudeMessages.length) {
    return Response.json({ error: 'bad_request', message: 'no messages' }, { status: 400 });
  }

  // Per-user daily cost guard (shared with /api/run-task). Each real chat turn
  // counts; fail-open if the counter is unavailable.
  const limit = await enforceDailyLimit(uid, idToken, new Date());
  if (!limit.ok) {
    return Response.json(
      { error: 'rate_limited', limit: limit.limit },
      { status: 429, headers: { 'retry-after': '3600' } },
    );
  }

  const serverBrief = await loadServerBrief(uid, idToken);
  const context = briefToContext(serverBrief) ?? FALLBACK_CONTEXT;
  const deptSummary =
    typeof body.deptSummary === 'string' && body.deptSummary.trim()
      ? `\n\nWhere their departments stand right now:\n${body.deptSummary.trim().slice(0, 1200)}`
      : '';
  const system = `${BYTE_SYSTEM}\n\nThe founder's company: ${context}${deptSummary}`;

  const client = new Anthropic({ apiKey });
  try {
    const mstream = client.messages.stream({
      model: 'claude-opus-4-8',
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      system,
      messages: claudeMessages,
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of mstream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
        } catch (err) {
          console.error('[chat] stream failed', err);
          controller.error(err);
          return;
        }
        controller.close();
      },
      cancel() {
        mstream.abort();
      },
    });

    return new Response(stream, {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  } catch (err) {
    console.error('[chat] generation failed', err);
    const status = err instanceof Anthropic.APIError ? (err.status ?? 502) : 502;
    return Response.json({ error: 'generation_failed' }, { status });
  }
}
