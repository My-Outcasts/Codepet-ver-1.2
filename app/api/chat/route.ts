// byte's conversational chat, made real (Phase 5.4 byte-chat). Streams a reply from
// the Claude API, grounded in the signed-in account's company: the brief is loaded
// server-side by the VERIFIED uid (never trusted from the client), and a compact
// department snapshot is passed as context so byte can talk about what's actually on
// the founder's plate. ANTHROPIC_API_KEY stays server-side; Node runtime for the SDK.
import { verifyIdToken } from '@/lib/firebase/admin';
import { loadServerCompany } from '@/lib/firebase/serverCompany';
import { loadServerLibrary } from '@/lib/firebase/serverLibrary';
import { selectPriorWork, composePriorWorkContext } from '@/lib/ai/priorWork';
import { enforceDailyLimit, usageSink } from '@/lib/firebase/serverUsage';
import { toClaudeMessages, type ChatTurn } from '@/lib/ai/chatMessages';
import { getClient, streamMessage, aiErrorResponse } from '@/lib/ai/client';
import { composeProjectModel } from '@/lib/ai/projectModel';
import { NAV_DESTINATIONS } from '@/lib/ai/navChip';
import { parseSetupItems, matchSetupItem, type SetupItem } from '@/lib/ai/envSetup';

export const runtime = 'nodejs';

const BYTE_SYSTEM = `You are byte, the AI building companion inside Codepet — a senior operator who helps a solo founder build and understand their whole company, department by department.

You are in a chat with the founder. Be warm, plain-spoken, specific, and brief — usually 2-4 sentences, occasionally a short list when it genuinely helps. No hype, no emoji, no filler. Write plain text only — no markdown, asterisks, backticks, or arrows for emphasis; the chat shows your words as-is. When they ask what to do next, ground your answer in their actual company and departments.

You can DO the work here, not only talk about it. When the founder asks you to run, make, draft, write, finish, or execute a task — or says "do it" / "run that for me" about the task you're discussing — call the run_task tool with the matching entry from RUNNABLE TASKS. The deliverable is produced right here in the chat for them to approve; never tell them to go open the task somewhere else. Say one short lead-in line first (e.g. "On it — running the willingness-to-pay survey.") and then call the tool. Rules: only call run_task for a task that is actually in RUNNABLE TASKS, using its exact deptK and taskTitle; if it's unclear which task they mean, ask a one-line clarifying question instead of guessing; and for questions, advice, or status, just reply — don't call the tool.

If the context names a CURRENT NEXT STEP, that is the founder's single agreed focus right now (it's what the map's beacon shows too). When they ask what to do next, lead with that exact task — you may add sequencing or detail, but never name a different task as the headline "next step," or the app will contradict itself.

You also know Codepet itself, so you can orient the founder and guide them through it. Its main functions:
- Company — their departments at a glance (what each is doing, what needs them). The home base for running the whole company.
- Roadmap — their product's journey through stages: Just an idea, Prototype, Private beta, Public beta, Launched, Growing. Shows where they are now and what's ahead.
- Tasks — the board of everything you're doing, drafting, or waiting on them to approve.
- Library — everything you've delivered and they've approved: their finished work.
- Environment — the tools and stack their company runs on.
- A department (Marketing, Finance, Engineering, and so on) — that team's tasks and current focus; opening one lets you work in it together.

When the founder asks what a part of the app is or how to use it, explain it plainly in a sentence or two, grounded in THEIR company — not a generic manual. When they ask where something is, or to see/open/go to one of these, ALSO call the navigate tool with the matching destination (for a department, its name as target) so they get a one-tap way there, and give a one-line spoken answer, e.g. "You're at the private beta stage — here's your roadmap." Only navigate for a real "where is / take me to / show me" ask; for a plain "what is X" question, explain it (you may still offer to take them).

When work you're about to run or discuss would clearly go better with a toolkit item that's currently off — a skill, connector, or agent in the SETUP TOOLKIT list — offer to turn it on and call the setup_capability tool with its exact category and name. Turning it on connects it for the founder right here (no separate setup). Say one short lead-in line first (e.g. "This'll go faster with Code review on — want me to turn it on?") and then call the tool. Rules: only suggest an item that's actually in SETUP TOOLKIT (they're all off); pick the single most relevant one; never raise the toolkit during plain questions, advice, or status — only when it genuinely helps the work at hand.`;

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

// The tool byte calls to take the founder to a part of the app when they ask where
// something is or to open/see/go to a function. The client turns a valid destination
// into a one-tap chip (it never navigates on its own). destination is validated against
// the shared NAV_DESTINATIONS list before we act on it.
const NAVIGATE_TOOL = {
  name: 'navigate',
  description:
    "Take the founder to a part of the Codepet app when they ask where something is, or ask to see/open/go to a function. Call this for navigational asks (e.g. 'where's my product on the roadmap?', 'show me my library', 'open Marketing'); for questions, advice, or running work, do NOT call it. Always also give a one-line spoken answer.",
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      destination: {
        type: 'string',
        enum: [...NAV_DESTINATIONS],
        description:
          'roadmap = the product stage timeline; tasks = the task board; library = delivered work; company = the departments overview; environment = tools/stack; department = a specific department (set target to its name).',
      },
      target: {
        type: 'string',
        description:
          'Only for destination "department": the department name or key (e.g. "Marketing"). Omit for the others.',
      },
    },
    required: ['destination'],
  },
};

// The tool byte calls to turn on a currently-off toolkit item (skill/connector/agent)
// for the founder. Validated against the SETUP TOOLKIT list (the off items the client
// sent) before we act, so an already-on or invented item is dropped.
const SETUP_TOOL = {
  name: 'setup_capability',
  description:
    "Turn on a currently-off toolkit item for the founder when it would clearly help the work at hand. Use the exact category and name from the SETUP TOOLKIT list. Only call this for an item in that list; for questions, advice, or status, do NOT call it. Always also give a one-line spoken lead-in.",
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      category: {
        type: 'string',
        enum: ['skills', 'connectors', 'agents'],
        description: 'The item’s category, copied exactly from SETUP TOOLKIT.',
      },
      name: {
        type: 'string',
        description: 'The exact item name, copied exactly from SETUP TOOLKIT.',
      },
    },
    required: ['category', 'name'],
  },
};

// Marker that separates byte's streamed reply text from a trailing action payload on the
// wire (a run_task run OR a navigate chip). Record-separator (U+001E) never appears in
// normal prose, so the client can split the stream cleanly: text before it, JSON after.
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
  envSetup?: unknown;
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

  let client: ReturnType<typeof getClient>;
  try {
    client = getClient();
  } catch (err) {
    return aiErrorResponse(err, 'not_configured');
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

  // Ground byte's advice in the same project model the generation route uses: the brief
  // narrative plus a digest of what the company has already shipped. Loaded in parallel
  // (no added latency); fail-open — an empty library just omits the shipped digest.
  const [company, library] = await Promise.all([
    loadServerCompany(uid, idToken),
    loadServerLibrary(uid, idToken),
  ]);
  const context =
    composeProjectModel({
      brief: company.brief,
      decisions: company.decisions,
      shipped: library,
    }) || FALLBACK_CONTEXT;
  // On top of the titles-only shipped digest (breadth), pull the CONTENT of the few
  // approved deliverables most relevant to what the founder just asked — so byte can
  // answer with the real substance of their work, not just name it. Keyed on the latest
  // founder message; capped tight since the digest already covers breadth.
  const lastFounderMsg = [...turns].reverse().find((t) => t.role === 'me')?.text ?? '';
  const relevantWork = composePriorWorkContext(
    selectPriorWork(library, { query: lastFounderMsg, max: 3 }),
  );
  const relevantBlock = relevantWork ? `\n\n${relevantWork}` : '';
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

  // The currently-off toolkit items byte may offer to turn on. Grounded here (exact
  // identifiers) and validated on the way back so an already-on/invented item can't act.
  const setupItems = parseSetupItems(body.envSetup);
  const setupBlock = setupItems.length
    ? `\n\nSETUP TOOLKIT (call setup_capability with the exact category + name to turn one on):\n${setupItems
        .map((s) => `- category:"${s.category}" name:"${s.name}" — ${s.why || 'no note'}`)
        .join('\n')}`
    : '';

  const system = `${BYTE_SYSTEM}\n\nThe founder's company: ${context}${relevantBlock}${deptSummary}${runnableBlock}${setupBlock}`;

  try {
    const mstream = streamMessage({
      client,
      system,
      messages: claudeMessages,
      maxTokens: 2048,
      label: 'chat',
      // navigate is always available (guiding around the app doesn't depend on open
      // tasks); run_task and setup_capability only when there's something real to act on.
      tools: [
        NAVIGATE_TOOL,
        ...(runnable.length ? [RUN_TASK_TOOL] : []),
        ...(setupItems.length ? [SETUP_TOOL] : []),
      ],
      onUsage: usageSink(uid, idToken, 'chat'),
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
          const navUse = final.content.find(
            (b): b is Extract<typeof b, { type: 'tool_use' }> =>
              b.type === 'tool_use' && b.name === 'navigate',
          );
          const setupUse = final.content.find(
            (b): b is Extract<typeof b, { type: 'tool_use' }> =>
              b.type === 'tool_use' && b.name === 'setup_capability',
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
          } else if (navUse) {
            // byte wants to guide them somewhere. Emit the destination only if it's a real
            // one; the client resolves it to a chip (and drops it if it can't). target is
            // passed through for a department; the client resolves the exact key/name.
            const input = navUse.input as { destination?: unknown; target?: unknown };
            const dest = typeof input.destination === 'string' ? input.destination : '';
            if ((NAV_DESTINATIONS as readonly string[]).includes(dest)) {
              const target = typeof input.target === 'string' ? input.target : undefined;
              controller.enqueue(
                encoder.encode(ACTION_MARK + JSON.stringify({ nav: dest, target })),
              );
            }
          } else if (setupUse) {
            // byte wants to turn on a toolkit item. Emit it only if it's a real off item
            // from SETUP TOOLKIT; the client renders an approval card and flips it on tap.
            const input = setupUse.input as { category?: unknown; name?: unknown };
            const match: SetupItem | null = matchSetupItem(setupItems, input.category, input.name);
            if (match) {
              controller.enqueue(
                encoder.encode(
                  ACTION_MARK + JSON.stringify({ setup: { category: match.category, name: match.name } }),
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
    return aiErrorResponse(err, 'generation_failed');
  }
}
