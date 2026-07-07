// byte's one-time project analysis. Right after onboarding (or on the first Overview
// visit for older accounts), byte reads the founder's brief and writes a short,
// grounded read of their project — shown on the Overview first run before the "next
// move" hand-off. Like /api/personalize and /api/scaffold: auth-gated, key server-side,
// brief loaded by the VERIFIED uid, usage recorded (not 429-gated — a one-time first-run
// read must never be blocked).
import { verifyIdToken } from '@/lib/firebase/admin';
import { briefToContext } from '@/lib/ai/brief';
import { loadServerBrief } from '@/lib/firebase/serverBrief';
import { usageSink } from '@/lib/firebase/serverUsage';
import { getClient, generateJson, aiErrorResponse } from '@/lib/ai/client';
import {
  ANALYSIS_SYSTEM,
  analysisPrompt,
  PROJECT_ANALYSIS_SCHEMA,
  isUsableAnalysis,
  type ProjectAnalysis,
} from '@/lib/ai/projectAnalysis';

export const runtime = 'nodejs';

interface AnalysisBody {
  brief?: unknown;
}

export async function POST(req: Request): Promise<Response> {
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

  let body: AnalysisBody = {};
  try {
    body = (await req.json()) as AnalysisBody;
  } catch {
    // Body optional — the brief is preferentially loaded server-side.
  }

  const serverBrief = await loadServerBrief(uid, idToken);
  const context = briefToContext(serverBrief) ?? briefToContext(body.brief);
  if (!context) {
    // No brief ⇒ nothing to analyze; client keeps the fallback intro.
    return Response.json({});
  }

  try {
    const parsed = await generateJson<Partial<ProjectAnalysis>>({
      client,
      system: ANALYSIS_SYSTEM,
      prompt: analysisPrompt(context),
      maxTokens: 4096,
      label: 'project-analysis',
      schema: PROJECT_ANALYSIS_SCHEMA,
      onUsage: usageSink(uid, idToken, 'project-analysis'),
    });
    // Guard the payload server-side too; an unusable one ⇒ empty ⇒ client fallback.
    return Response.json(isUsableAnalysis(parsed) ? parsed : {});
  } catch (err) {
    return aiErrorResponse(err, 'generation_failed');
  }
}
