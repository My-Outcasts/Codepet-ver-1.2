// Phase 3 — byte's task loop, made real. This server route calls the Claude API
// to generate a deliverable from the user's company context + the task. The
// ANTHROPIC_API_KEY stays server-side (never NEXT_PUBLIC). Node runtime so the
// official SDK runs.
//
// Kinds:
//   text                          → plain-text deliverable, returns { text }
//   post/email/legal/screens/sheet/site → structured deliverable via output_config.format, returns { payload }
// All kinds support a revise pass (reviseNote + current draft).
import { verifyIdToken } from '@/lib/firebase/admin';
import { loadServerCompany } from '@/lib/firebase/serverCompany';
import { loadServerLibrary } from '@/lib/firebase/serverLibrary';
import { enforceDailyLimit, usageSink } from '@/lib/firebase/serverUsage';
import { aiClientFor } from '@/lib/firebase/serverUserKey';
import { getClient, generateText, generateJson, aiErrorResponse } from '@/lib/ai/client';
import { selectPriorWork, composePriorWorkContext } from '@/lib/ai/priorWork';
import { composeProjectModel } from '@/lib/ai/projectModel';
import {
  STRUCTURED_SCHEMAS,
  DELIVERABLE_INSTRUCTIONS,
  type StructuredKind,
} from '@/lib/ai/deliverableSchemas';
import {
  CODEPET_CONTEXT,
  composeRunSystem,
  buildTaskPrompt,
  type TaskFields,
} from '@/lib/ai/runTaskPrompt';
import { personaOverride } from '@/lib/companions';

export const runtime = 'nodejs';

// Structured-output schemas + prompt instructions live in a pure, unit-tested
// module (lib/ai/deliverableSchemas.ts). `text` has no schema (plain text).
// Prompt construction (byte's system contract + the cache-safe system/user split)
// lives in lib/ai/runTaskPrompt.ts.
type Kind = 'text' | StructuredKind;

const KINDS: Record<Kind, { schema: Record<string, unknown> | null; instruction: string }> = {
  text: { schema: null, instruction: DELIVERABLE_INSTRUCTIONS.text },
  doc: { schema: STRUCTURED_SCHEMAS.doc, instruction: DELIVERABLE_INSTRUCTIONS.doc },
  post: { schema: STRUCTURED_SCHEMAS.post, instruction: DELIVERABLE_INSTRUCTIONS.post },
  email: { schema: STRUCTURED_SCHEMAS.email, instruction: DELIVERABLE_INSTRUCTIONS.email },
  legal: { schema: STRUCTURED_SCHEMAS.legal, instruction: DELIVERABLE_INSTRUCTIONS.legal },
  screens: { schema: STRUCTURED_SCHEMAS.screens, instruction: DELIVERABLE_INSTRUCTIONS.screens },
  sheet: { schema: STRUCTURED_SCHEMAS.sheet, instruction: DELIVERABLE_INSTRUCTIONS.sheet },
  site: { schema: STRUCTURED_SCHEMAS.site, instruction: DELIVERABLE_INSTRUCTIONS.site },
  dms: { schema: STRUCTURED_SCHEMAS.dms, instruction: DELIVERABLE_INSTRUCTIONS.dms },
  calendar: {
    schema: STRUCTURED_SCHEMAS.calendar,
    instruction: DELIVERABLE_INSTRUCTIONS.calendar,
  },
  checklist: {
    schema: STRUCTURED_SCHEMAS.checklist,
    instruction: DELIVERABLE_INSTRUCTIONS.checklist,
  },
  plan: { schema: STRUCTURED_SCHEMAS.plan, instruction: DELIVERABLE_INSTRUCTIONS.plan },
};

interface RunTaskBody {
  kind?: unknown;
  taskTitle?: unknown;
  taskHint?: unknown;
  deptName?: unknown;
  deptKey?: unknown;
  reviseNote?: unknown;
  current?: unknown;
  brief?: unknown;
  companionId?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  // Require a valid Firebase ID token — the endpoint calls a paid API, so it
  // must not be reachable by unauthenticated clients.
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

  // BYOK: run on the user's own key when they've set one (byok=true → cap waived below), else the
  // platform key. Fail-open inside aiClientFor: a resolve error just falls back to the platform key.
  let client: ReturnType<typeof getClient>;
  let byok = false;
  try {
    const resolved = await aiClientFor(uid);
    client = resolved.client;
    byok = resolved.byok;
  } catch (err) {
    return aiErrorResponse(err, 'not_configured');
  }

  let body: RunTaskBody;
  try {
    body = (await req.json()) as RunTaskBody;
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const kind: Kind =
    typeof body.kind === 'string' && body.kind in KINDS ? (body.kind as Kind) : 'text';
  const taskTitle = typeof body.taskTitle === 'string' ? body.taskTitle.trim() : '';
  if (!taskTitle) {
    return Response.json(
      { error: 'bad_request', message: 'taskTitle is required.' },
      { status: 400 },
    );
  }
  const fields: TaskFields = {
    taskTitle,
    taskHint: typeof body.taskHint === 'string' ? body.taskHint.slice(0, 400) : undefined,
    deptName: typeof body.deptName === 'string' ? body.deptName : undefined,
    deptKey: typeof body.deptKey === 'string' ? body.deptKey : undefined,
    reviseNote: typeof body.reviseNote === 'string' ? body.reviseNote.slice(0, 400) : undefined,
    current: typeof body.current === 'string' ? body.current.slice(0, 6000) : undefined,
  };

  // Per-user daily cost guard: count this attempt and stop if the account is over
  // its cap (fail-open if the counter is unavailable — never block on infra).
  // BYOK accounts pay their own Anthropic bill → skip the shared-key daily cap entirely.
  if (!byok) {
    const limit = await enforceDailyLimit(uid, idToken, new Date());
    if (!limit.ok) {
      return Response.json(
        { error: 'rate_limited', limit: limit.limit },
        { status: 429, headers: { 'retry-after': '3600' } },
      );
    }
  }

  // Prefer the caller's REAL persisted brief (loaded by the verified uid) over
  // whatever the client passed, so generation is always scoped to the signed-in
  // account; fall back to the client brief (e.g. mid-onboarding) then the baseline.
  // Load the company (brief + locked-in decisions, one masked read) and the approved-
  // deliverable library together. Both ground byte so a new deliverable stays consistent
  // with what's decided and shipped; fail-open — empty values just skip that grounding.
  const [company, library] = await Promise.all([
    loadServerCompany(uid, idToken),
    loadServerLibrary(uid, idToken),
  ]);
  // The project model (brief narrative + locked-in decisions + a breadth digest of
  // shipped work) is the top-level grounding; the prior-work block below adds depth on
  // the most relevant items. All derive from state already loaded above — no extra reads.
  const context =
    composeProjectModel({
      brief: company.brief,
      fallbackBrief: body.brief,
      decisions: company.decisions,
      shipped: library,
    }) || CODEPET_CONTEXT;
  const priorWork = composePriorWorkContext(
    selectPriorWork(library, {
      deptName: fields.deptName,
      excludeTitle: fields.taskTitle,
      // Rank prior work by relevance to what this task is actually about, so byte grounds
      // on the pieces it must stay consistent with (across departments), not just recency.
      query: [fields.taskTitle, fields.taskHint, fields.reviseNote].filter(Boolean).join(' '),
    }),
  );
  const { schema, instruction } = KINDS[kind];
  const companionId = typeof body.companionId === 'string' ? body.companionId : undefined;
  // Cache-safe split: the stable company context goes in the system (cached across the
  // session's generations); only the per-task prompt varies call to call. The persona
  // override is appended last so it wins over the "You are byte…" opening; it feeds
  // BOTH generation call sites below (structured + plain text) since they share `system`.
  const system = composeRunSystem(context) + personaOverride(companionId);
  const prompt = buildTaskPrompt({ instruction, priorWork, fields });
  const onUsage = usageSink(uid, idToken, 'runTask');

  try {
    if (schema) {
      const payload = await generateJson({
        client,
        system,
        prompt,
        maxTokens: 4096,
        label: `run-task:${kind}`,
        schema,
        onUsage,
      });
      return Response.json({ payload });
    }
    const text = await generateText({
      client,
      system,
      prompt,
      maxTokens: 4096,
      label: `run-task:${kind}`,
      onUsage,
    });
    return Response.json({ text });
  } catch (err) {
    return aiErrorResponse(err, 'generation_failed');
  }
}
