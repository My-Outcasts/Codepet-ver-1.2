// byte's "single next step" picker. Given the founder's company + the list of
// open tasks, byte chooses the ONE task to do next and why. The result is the
// single source of truth both the Overview beacon and byte's chat read, so they
// can never contradict each other about what's next.
//
// This is a background orchestration call (fires on load + after each approval),
// not a user-triggered deliverable, so it is auth-gated but does NOT count against
// the per-user daily deliverable cap. The org-level Anthropic spend limit is the
// backstop; the client caches the result so it only re-runs on real state changes.
import Anthropic from '@anthropic-ai/sdk';
import { verifyIdToken } from '@/lib/firebase/admin';
import { briefToContext } from '@/lib/ai/brief';
import { loadServerBrief } from '@/lib/firebase/serverBrief';

export const runtime = 'nodejs';

const SYSTEM = `You are byte, the AI operator inside Codepet, helping a solo founder build their whole company. Given their company and the list of open tasks across every department, choose the SINGLE most important task to do next — the true critical path, the one that unblocks the most.

Sequence sensibly: build the core product before promoting it, stand up the essentials before scaling, and prefer work that later tasks depend on. Return the chosen task's index and one plain-language sentence on why it's the next move.`;

const CODEPET_CONTEXT = `Codepet is a macOS companion that builds your whole company with you, department by department — reading your project, writing the brief and roadmap, then doing real work across Engineering, Marketing, Design, Finance, Operations, Legal, Sales, and Support.`;

interface NextStepBody {
  tasks?: unknown;
}

interface TaskItem {
  deptName: string;
  title: string;
  desc: string;
}

function normalizeTasks(raw: unknown): TaskItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 40)
    .map((t) => {
      const o = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>;
      return {
        deptName: typeof o.deptName === 'string' ? o.deptName : '',
        title: typeof o.title === 'string' ? o.title : '',
        desc: typeof o.desc === 'string' ? o.desc : '',
      };
    })
    .filter((t) => t.title.length > 0);
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
  if (!apiKey) return Response.json({ error: 'not_configured' }, { status: 503 });

  let body: NextStepBody;
  try {
    body = (await req.json()) as NextStepBody;
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const tasks = normalizeTasks(body.tasks);
  if (tasks.length === 0) return Response.json({ error: 'bad_request' }, { status: 400 });
  // A single open task is trivially the next step — skip the model call.
  if (tasks.length === 1) return Response.json({ pick: 0, why: '' });

  const serverBrief = await loadServerBrief(uid, idToken);
  const context = briefToContext(serverBrief) ?? CODEPET_CONTEXT;

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      pick: {
        type: 'integer',
        description: `Index (0-based, from 0 to ${tasks.length - 1}) of the single most important task to do next — must be one of the listed indices.`,
      },
      why: {
        type: 'string',
        description: 'One plain-language sentence on why this is the next step.',
      },
    },
    required: ['pick', 'why'],
  };

  const list = tasks
    .map((t, i) => `${i}. [${t.deptName}] ${t.title}${t.desc ? ` — ${t.desc}` : ''}`)
    .join('\n');
  const prompt = `The founder's company: ${context}\n\nOpen tasks across their departments:\n${list}\n\nPick the single task to do next (its index) and give one sentence why.`;

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    });

    if (message.stop_reason === 'refusal') {
      return Response.json({ error: 'refused' }, { status: 422 });
    }
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (!text) return Response.json({ error: 'empty' }, { status: 502 });

    let parsed: { pick?: unknown; why?: unknown };
    try {
      parsed = JSON.parse(text) as { pick?: unknown; why?: unknown };
    } catch {
      return Response.json({ error: 'parse_failed' }, { status: 502 });
    }
    const pick = typeof parsed.pick === 'number' ? Math.trunc(parsed.pick) : -1;
    if (pick < 0 || pick >= tasks.length) {
      return Response.json({ error: 'invalid_pick' }, { status: 502 });
    }
    return Response.json({ pick, why: typeof parsed.why === 'string' ? parsed.why : '' });
  } catch (err) {
    console.error('[next-step] pick failed', err);
    const status = err instanceof Anthropic.APIError ? (err.status ?? 502) : 502;
    return Response.json({ error: 'pick_failed' }, { status });
  }
}
