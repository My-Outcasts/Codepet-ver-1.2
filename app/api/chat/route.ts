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

You are in a chat with the founder. Be warm, plain-spoken, specific, and brief — usually 2-4 sentences, occasionally a short list when it genuinely helps. No hype, no emoji, no filler. Write plain text only — no markdown, asterisks, backticks, or arrows for emphasis; the chat shows your words as-is. When they ask what to do next, ground your answer in their actual company and departments.

You can DO the work here, not only talk about it. When the founder asks you to run, make, draft, write, finish, or execute a task — or says "do it" / "run that for me" about the task you're discussing — call the run_task tool with the matching entry from RUNNABLE TASKS. The deliverable is produced right here in the chat for them to approve; never tell them to go open the task somewhere else. Say one short lead-in line first (e.g. "On it — running the willingness-to-pay survey.") and then call the tool. Rules: only call run_task for a task that is actually in RUNNABLE TASKS, using its exact deptK and taskTitle; if it's unclear which task they mean, ask a one-line clarifying question instead of guessing; and for questions, advice, or status, just reply — don't call the tool.

If the context names a CURRENT NEXT STEP, that is the founder's single agreed focus right now (it's what the map's beacon shows too). When they ask what to do next, lead with that exact task — you may add sequencing or detail, but never name a different task as the headline "next step," or the app will contradict itself.`;

// The tool byte calls to actually produce a deliverable inside the chat. Its input
// must reference a real open task (validated against RUNNABLE TASKS before we act).
const RUN_TASK_TOOL = {
  name: 'run_task',
  description:
    "Produce a task's real deliverable right now, in this chat, for the founder to approve. Call this when the founder asks you to run/do/make/draft/finish/execute a specific task from the RUNNABLE TASKS list. Use the exact deptK and taskTitle from that list. If it's ambiguous which task they mean, do NOT call this — ask a clarifying question instead.",
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      deptK: {
        type: 'string',
        description: 'The department key (deptK) of the task, copied exactly from RUNNABLE TASKS.',
      },
      taskTitle: {
        type: 'string',
        description: 'The exact task title, copied exactly from RUNNABLE TASKS.',
      },
    },
    required: ['deptK', 'taskTitle'],
  },
};

// Marker that separates byte's streamed reply text from a trailing run_task action
// payload on the wire. Record-separator (U+001E) never appears in normal prose, so
// the client can split the stream cleanly: text before it, JSON action after.
const ACTION_MARK = String.fromCharCode(0x1e);

interface RunnableTask {
  deptK: string;
  deptName: string;
  taskTitle: string;
  hint: string;
}

function parseOpenTasks(raw: unknown): RunnableTask[] {
  if (!Array.isArray(raw)) return [];
  const out: RunnableTask[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.deptK === 'string' && typeof o.taskTitle === 'string') {
      out.push({
        deptK: o.deptK,
        deptName: typeof o.deptName === 'string' ? o.deptName : o.deptK,
        taskTitle: o.taskTitle,
        hint: typeof o.hint === 'string' ? o.hint : '',
      });
    }
  }
  return out.slice(0, 60);
}

const FALLBACK_CONTEXT =
  'The founder is building their company with Codepet but has not filled in a detailed brief yet — keep guidance general and invite them to tell you more.';

interface ChatBody {
  messages?: unknown;
  deptSummary?: unknown;
  openTasks?: unknown;
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

  // The tasks byte is allowed to run from chat. Included in the prompt so byte uses
  // exact identifiers, and validated on the way back so a hallucinated title can't act.
  const runnable = parseOpenTasks(body.openTasks);
  const runnableBlock = runnable.length
    ? `\n\nRUNNABLE TASKS (call run_task with the exact deptK + taskTitle to produce one here):\n${runnable
        .map(
          (r) =>
            `- deptK:"${r.deptK}" taskTitle:"${r.taskTitle}" — ${r.hint || 'no hint'} (${r.deptName})`,
        )
        .join('\n')}`
    : '\n\nRUNNABLE TASKS: none open right now — if the founder asks you to run something, tell them there are no open tasks to run.';
  const system = `${BYTE_SYSTEM}\n\nThe founder's company: ${context}${deptSummary}${runnableBlock}`;

  const client = new Anthropic({ apiKey });
  try {
    const mstream = client.messages.stream({
      model: 'claude-opus-4-8',
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      system,
      messages: claudeMessages,
      tools: runnable.length ? [RUN_TASK_TOOL] : undefined,
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
          // After the reply streams, see whether byte chose to run a task. Only act on
          // a tool call that matches a real runnable task (exact title; deptK is a
          // best-effort match) — so a wrong or invented reference is dropped silently.
          const final = await mstream.finalMessage();
          const toolUse = final.content.find(
            (b): b is Extract<typeof b, { type: 'tool_use' }> =>
              b.type === 'tool_use' && b.name === 'run_task',
          );
          if (toolUse) {
            const input = toolUse.input as { deptK?: unknown; taskTitle?: unknown };
            const taskTitle = typeof input.taskTitle === 'string' ? input.taskTitle : '';
            const deptK = typeof input.deptK === 'string' ? input.deptK : '';
            const match =
              runnable.find((r) => r.deptK === deptK && r.taskTitle === taskTitle) ||
              runnable.find((r) => r.taskTitle === taskTitle);
            if (match) {
              controller.enqueue(
                encoder.encode(
                  ACTION_MARK + JSON.stringify({ deptK: match.deptK, taskTitle: match.taskTitle }),
                ),
              );
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
