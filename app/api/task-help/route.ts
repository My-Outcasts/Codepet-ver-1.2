// Assisted founder tasks — the "needs your input" help generator. Given a founder-OWNED
// roadmap task (byte can't do it for them — incorporate, open a bank account), this route
// calls Claude to produce a short, grounded how-to guide plus an optional capture-form spec
// for the task's NON-SENSITIVE output. The captured values land in the company `decisions`
// memory that every downstream generation already reads, so finishing one founder task
// quietly informs the next.
//
// Mirrors /api/run-task exactly: same runtime/config, same auth + company grounding
// (loadServerCompany → composeProjectModel), same per-user daily guard (enforceDailyLimit),
// the same shared Anthropic client + persona override, and the same error→HTTP mapping via
// aiErrorResponse. Structured output is forced with generateJson (json_schema =
// TASK_HELP_SCHEMA); the raw model object is run through coerceTaskHelp before it ships.
import { verifyIdToken } from '@/lib/firebase/admin';
import { loadServerCompany } from '@/lib/firebase/serverCompany';
import { loadServerLibrary } from '@/lib/firebase/serverLibrary';
import { enforceDailyLimit, usageSink } from '@/lib/firebase/serverUsage';
import { getClient, generateJson, aiErrorResponse } from '@/lib/ai/client';
import { composeProjectModel } from '@/lib/ai/projectModel';
import { CODEPET_CONTEXT, composeRunSystem } from '@/lib/ai/runTaskPrompt';
import { departmentBrief } from '@/lib/ai/departments';
import { companionForDept, personaOverride } from '@/lib/companions';
import { TASK_HELP_SCHEMA, coerceTaskHelp, type TaskHelp } from '@/lib/ai/taskHelp';

export const runtime = 'nodejs';

interface TaskHelpBody {
  taskTitle?: unknown;
  taskHint?: unknown;
  deptName?: unknown;
  deptKey?: unknown;
  brief?: unknown;
  companionId?: unknown;
}

interface TaskHelpFields {
  taskTitle: string;
  taskHint?: string;
  deptName?: string;
  deptKey?: string;
}

// The per-task USER prompt. Kept out of the (cached) system so the company context caches
// across a session while only this varies call to call — same split rule as run-task.
// All of the "how-to + non-sensitive capture" contract is baked in here.
function buildTaskHelpPrompt(fields: TaskHelpFields): string {
  const { taskTitle, taskHint, deptName, deptKey } = fields;
  const lines: (string | null)[] = [
    'This is a founder-OWNED task — something the founder must do themselves in the real world (byte cannot do it for them). Produce a short, grounded how-to guide plus, when it applies, a tiny form to capture the task’s non-sensitive result.',
    '',
    deptName ? `Department: ${deptName}` : null,
    deptKey && departmentBrief(deptKey) ? departmentBrief(deptKey) : null,
    `Task: ${taskTitle}`,
    taskHint ? `Context: ${taskHint}` : null,
    '',
    'GUIDE — make it specific to THIS founder and THIS task, grounded in the company context above (its decisions and brief). Keep it tight:',
    '- guide.call: ONE line on why this matters now for this company.',
    '- guide.steps: 3–4 steps. h = a short imperative (a few words); p = one or two plain sentences.',
    '- guide.options: 2–3 real, named providers/tools each with a one-line why — ONLY when the task genuinely has a product/provider choice (e.g. a bank account, incorporation, a payments processor). OMIT options entirely otherwise.',
    '- guide.est: a rough time estimate like "~15 min".',
    '',
    'CAPTURE (optional) — 1–3 fields that record the task’s OUTPUT and would be useful to remember for later tasks (e.g. bank account → {key:"bank", label:"Which bank?"}; incorporation → {key:"incorporation-state", label:"State"}, {key:"entity-type", label:"Entity type"}).',
    'HARD RULE: NEVER request secrets or sensitive numbers — no EIN, no account numbers, no routing numbers, no SSN, no passwords, no card numbers. Only non-sensitive identifiers or choices the founder made.',
    'If the task has no useful capturable output, OMIT capture entirely.',
    'capture.note: a one-line "these are suggestions — verify before acting" disclaimer; for legal or financial tasks also note this is not legal or financial advice.',
    '',
    'Return ONLY the structured object. Do not invent facts about the company that are not in the context.',
  ];
  return lines.filter((l) => l !== null).join('\n');
}

export async function POST(req: Request): Promise<Response> {
  // Require a valid Firebase ID token — the endpoint calls a paid API, so it must not be
  // reachable by unauthenticated clients.
  const authz = req.headers.get('authorization') ?? '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  if (!idToken) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  let uid: string;
  try {
    const decoded = await verifyIdToken(idToken);
    uid = decoded.uid;
  } catch {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let client: ReturnType<typeof getClient>;
  try {
    client = getClient();
  } catch (err) {
    return aiErrorResponse(err, 'not_configured');
  }

  let body: TaskHelpBody;
  try {
    body = (await req.json()) as TaskHelpBody;
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const taskTitle = typeof body.taskTitle === 'string' ? body.taskTitle.trim() : '';
  if (!taskTitle) {
    return Response.json(
      { error: 'bad_request', message: 'taskTitle is required.' },
      { status: 400 },
    );
  }
  const fields: TaskHelpFields = {
    taskTitle,
    taskHint: typeof body.taskHint === 'string' ? body.taskHint.slice(0, 400) : undefined,
    deptName: typeof body.deptName === 'string' ? body.deptName : undefined,
    deptKey: typeof body.deptKey === 'string' ? body.deptKey : undefined,
  };

  // Per-user daily cost guard: count this attempt and stop if the account is over its cap
  // (fail-open if the counter is unavailable — never block on infra). Same 429 as run-task.
  const limit = await enforceDailyLimit(uid, idToken, new Date());
  if (!limit.ok) {
    return Response.json(
      { error: 'rate_limited', limit: limit.limit },
      { status: 429, headers: { 'retry-after': '3600' } },
    );
  }

  // Prefer the caller's REAL persisted brief (loaded by the verified uid) over whatever the
  // client passed; fall back to the client brief (mid-onboarding) then the baseline. Load
  // the company + approved-deliverable library so the guide grounds in what's decided and
  // shipped; fail-open — empty values just skip that grounding.
  const [company, library] = await Promise.all([
    loadServerCompany(uid, idToken),
    loadServerLibrary(uid, idToken),
  ]);
  const context =
    composeProjectModel({
      brief: company.brief,
      fallbackBrief: body.brief,
      decisions: company.decisions,
      shipped: library,
    }) || CODEPET_CONTEXT;

  // Voice-per-department: the persona is the department's fixed pet, resolved from deptKey.
  // Cache-safe split: the stable company context goes in the (cached) system; the persona
  // override is appended last so it wins over the "You are byte…" opening. Only the per-task
  // prompt below varies call to call.
  // Persona is per-department; keep it OUT of the cached prefix so consecutive runs in
  // different departments still hit the cached stable system (byte system + company model).
  const system = {
    stable: composeRunSystem(context),
    volatile: personaOverride(companionForDept(fields.deptKey).id),
  };
  const prompt = buildTaskHelpPrompt(fields);
  const onUsage = usageSink(uid, idToken, 'runTask');

  let raw: unknown;
  try {
    raw = await generateJson({
      client,
      system,
      prompt,
      maxTokens: 2048,
      label: 'task-help',
      schema: TASK_HELP_SCHEMA as unknown as Record<string, unknown>,
      onUsage,
    });
  } catch (err) {
    return aiErrorResponse(err, 'generation_failed');
  }

  // Defensively coerce (caps list sizes, drops keyless fields). A null means the model
  // returned nothing usable — signal the same bad-generation 502 run-task uses.
  const help: TaskHelp | null = coerceTaskHelp(raw);
  if (!help) {
    return Response.json({ error: 'generation_failed' }, { status: 502 });
  }
  return Response.json(help);
}
