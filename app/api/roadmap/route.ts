// Phase 4 — byte generates a real, per-company roadmap. Mirrors /api/scaffold: auth-gated,
// holds the Anthropic key server-side, reads the founder's brief, and asks byte for a
// company-building roadmap tailored to their product — phases → department-tagged tasks →
// dependencies. POST generates (and persists); GET returns the last-generated roadmap.
import { verifyIdToken } from '@/lib/firebase/admin';
import { loadServerBrief } from '@/lib/firebase/serverBrief';
import { writeServerRoadmap, loadServerRoadmap } from '@/lib/firebase/serverRoadmap';
import { getClient, generateJson, aiErrorResponse } from '@/lib/ai/client';
import { briefToContext } from '@/lib/ai/brief';
import {
  ROADMAP_PHASE_KEYS,
  ROADMAP_DEPT_KEYS,
  roadmapFromGenerated,
  type GeneratedRoadmap,
} from '@/lib/overview/roadmapGenerated';
import { ROADMAP_PHASES } from '@/lib/overview/roadmapTemplate';
import type { CompanyBrief } from '@/lib/firebase/schema';

export const runtime = 'nodejs';

const SYSTEM = `You are byte, the AI building companion inside Codepet, laying out a founder's whole company as a roadmap. You plan the real, concrete path THIS founder should follow — not a generic checklist. Ground everything in their product, audience, and stage; never invent facts.`;

const PHASE_NAMES = ROADMAP_PHASES.map((p) => `${p.key} (${p.name})`).join(', ');

const ROADMAP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tasks: {
      type: 'array',
      description:
        'The whole company-building roadmap: 2-4 tasks per phase, each owned by one department.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          phase: {
            type: 'string',
            enum: ROADMAP_PHASE_KEYS,
            description: 'Which phase this task belongs to.',
          },
          dept: {
            type: 'string',
            enum: [...ROADMAP_DEPT_KEYS],
            description: 'The single department that owns this task.',
          },
          title: {
            type: 'string',
            description: 'Short, concrete task title specific to this company (unique).',
          },
          deps: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Titles of tasks that MUST be done before this one (exact matches). Use these to draw the critical path; leave empty for an entry point.',
          },
        },
        required: ['phase', 'dept', 'title', 'deps'],
      },
    },
  },
  required: ['tasks'],
};

async function authUid(req: Request): Promise<string | null> {
  const authz = req.headers.get('authorization') ?? '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  if (!idToken) return null;
  try {
    return (await verifyIdToken(idToken)).uid;
  } catch {
    return null;
  }
}

function tokenOf(req: Request): string {
  const authz = req.headers.get('authorization') ?? '';
  return authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
}

// GET — return the founder's last-generated roadmap (or null).
export async function GET(req: Request): Promise<Response> {
  const uid = await authUid(req);
  if (!uid) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const roadmap = await loadServerRoadmap(uid, tokenOf(req));
  return Response.json({ roadmap: Array.isArray(roadmap) ? roadmap : null });
}

// POST — generate a fresh roadmap from the founder's brief, persist it, return it.
export async function POST(req: Request): Promise<Response> {
  const uid = await authUid(req);
  if (!uid) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const idToken = tokenOf(req);

  let client: ReturnType<typeof getClient>;
  try {
    client = getClient();
  } catch (err) {
    return aiErrorResponse(err, 'not_configured');
  }

  let body: { brief?: unknown } = {};
  try {
    body = (await req.json()) as { brief?: unknown };
  } catch {
    // body optional; the server-loaded brief is preferred anyway
  }

  const serverBrief = await loadServerBrief(uid, idToken);
  const context =
    briefToContext(serverBrief as CompanyBrief) ?? briefToContext(body.brief as CompanyBrief);
  if (!context) {
    // No real brief → don't invent a company; the client keeps the canonical template.
    return Response.json({ roadmap: null, noBrief: true });
  }
  const rawStage =
    serverBrief && typeof serverBrief === 'object'
      ? (serverBrief as { stage?: unknown }).stage
      : undefined;
  const stage = typeof rawStage === 'string' && rawStage.trim() ? rawStage.trim() : 'unspecified';

  const prompt = `Company: ${context}

The founder's current stage: ${stage}.

Lay out their whole company as a roadmap across these phases (use only these keys): ${PHASE_NAMES}.
Foundation is the company shell — incorporate, bank account, bookkeeping, brand — built in parallel with early product work.

For each phase write 2-4 concrete tasks specific to THIS company, each owned by ONE department (eng, mkt, ops, fin, legal, design, sales, support). Every phase should recruit a spread of departments, not just product — this builds a COMPANY, not only a product. For each task list \`deps\`: the exact titles of tasks that must come first (so the critical path can be drawn); leave \`deps\` empty for a phase's entry points. Keep titles short, specific, and unique.`;

  let gen: GeneratedRoadmap;
  try {
    gen = await generateJson<GeneratedRoadmap>({
      client,
      system: SYSTEM,
      prompt,
      maxTokens: 4096,
      label: 'roadmap',
      schema: ROADMAP_SCHEMA,
    });
  } catch (err) {
    return aiErrorResponse(err, 'roadmap_failed');
  }

  const roadmap = roadmapFromGenerated(gen);
  if (!roadmap.length) return Response.json({ roadmap: null });
  await writeServerRoadmap(uid, idToken, roadmap); // best-effort persist
  return Response.json({ roadmap });
}
