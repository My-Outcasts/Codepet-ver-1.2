// Part 1 — stage-aware company scaffold. Right after onboarding, byte reads the
// founder's product + stage and generates a company appropriate to WHERE THEY ARE:
// which departments have real work now vs. later, and for each active department a
// short list of concrete, stage-fit tasks (each declaring its deliverable `kind`,
// since a generated task has no payload yet).
//
// Auth-gated; holds the Anthropic key server-side; loads the brief from Firestore by
// the verified uid. The 8 department slots are fixed (keyed by `k`) so the result
// maps cleanly onto the app; byte only decides active/dormant + the tasks.
import Anthropic from '@anthropic-ai/sdk';
import { verifyIdToken } from '@/lib/firebase/admin';
import { briefToContext } from '@/lib/ai/brief';
import { loadServerBrief } from '@/lib/firebase/serverBrief';

export const runtime = 'nodejs';

// Generic department roles (NOT the Codepet-specific seed) so byte scaffolds from the
// founder's own product. Keys/names match the app's fixed 8 departments.
const DEPARTMENTS: { k: string; name: string; role: string }[] = [
  { k: 'eng', name: 'Engineering', role: 'building the product itself' },
  { k: 'design', name: 'Design', role: 'product design, UX, and onboarding' },
  { k: 'mkt', name: 'Marketing', role: 'positioning, launch, content, and audience' },
  { k: 'sales', name: 'Sales', role: 'landing first customers, outreach' },
  { k: 'support', name: 'Support', role: 'help docs, user success' },
  { k: 'fin', name: 'Finance', role: 'pricing, financial model, fundraising' },
  { k: 'ops', name: 'Operations', role: 'infrastructure, process, launch logistics' },
  { k: 'legal', name: 'Legal', role: 'policies, terms, compliance' },
];
const DEPT_KEYS = DEPARTMENTS.map((d) => d.k);

// Deliverable kinds byte can assign (all are produced live by /api/run-task).
const KINDS = [
  'doc',
  'prep',
  'build',
  'post',
  'email',
  'legal',
  'screens',
  'sheet',
  'site',
  'dms',
  'calendar',
  'checklist',
  'plan',
];

const SYSTEM = `You are byte, the AI building companion inside Codepet, setting up a founder's company for the FIRST time. You produce a plan tailored to exactly where they are in their journey — not a generic checklist.

Voice: warm, plain-language, specific. No hype, no emoji.`;

const CODEPET_CONTEXT = `a founder building their company with Codepet`;

const SCAFFOLD_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    departments: {
      type: 'array',
      description: 'Exactly one entry per provided department key, in any order.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          k: { type: 'string', enum: DEPT_KEYS, description: 'The department key.' },
          active: {
            type: 'boolean',
            description:
              'True if this department has real work to do at the founder’s CURRENT stage.',
          },
          tasks: {
            type: 'array',
            description:
              'For an active department, 2-4 concrete tasks for THIS stage; for a dormant one, an empty array.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                t: { type: 'string', description: 'Short task title, specific to this company.' },
                d: { type: 'string', description: 'One-line description of the task.' },
                who: {
                  type: 'string',
                  enum: ['does', 'draft', 'you'],
                  description:
                    'does = byte does it live; draft = byte drafts for approval; you = the founder must do it.',
                },
                kind: {
                  type: 'string',
                  enum: KINDS,
                  description: 'The deliverable this task produces.',
                },
              },
              required: ['t', 'd', 'who', 'kind'],
            },
          },
        },
        required: ['k', 'active', 'tasks'],
      },
    },
  },
  required: ['departments'],
};

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

  const serverBrief = await loadServerBrief(uid, idToken);
  const context = briefToContext(serverBrief) ?? CODEPET_CONTEXT;
  const rawStage =
    serverBrief && typeof serverBrief === 'object'
      ? (serverBrief as { stage?: unknown }).stage
      : undefined;
  const stage = typeof rawStage === 'string' && rawStage.trim() ? rawStage.trim() : 'unspecified';

  const deptList = DEPARTMENTS.map((d) => `- ${d.k} (${d.name}): ${d.role}`).join('\n');
  const prompt = `Company: ${context}

The founder's current stage: ${stage}.

Departments (fixed — one entry per key in your output):
${deptList}

Decide, for THIS company at THIS stage, which departments have real work to do NOW (active) and which come later (dormant, empty tasks). For each ACTIVE department, write 2-4 concrete, stage-appropriate tasks specific to this product — earlier stages skew toward validation/product; later stages toward launch/growth/scale. Give each task the right deliverable \`kind\` and \`who\`. Don't invent departments; use only the keys above.`;

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCAFFOLD_SCHEMA } },
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
    try {
      return Response.json({ scaffold: JSON.parse(text) });
    } catch {
      return Response.json({ error: 'parse_failed' }, { status: 502 });
    }
  } catch (err) {
    console.error('[scaffold] generation failed', err);
    const status = err instanceof Anthropic.APIError ? (err.status ?? 502) : 502;
    return Response.json({ error: 'scaffold_failed' }, { status });
  }
}
