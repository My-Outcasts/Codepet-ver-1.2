// Cloud demo build — credit-gated, single-flight boot of an E2B sandbox. Mirrors the
// Firebase-ID-token + missing-env(503) pattern from /api/build-plan, but this route never
// talks to Anthropic directly: it mints a build session, boots a detached sandbox (via
// startCloudBuild), and returns immediately so the browser can subscribe to the sandbox's
// self-reported progress at liveBuilds/{buildSessionId} (see app/api/track/live). Charging
// happens later, on a successful /api/build/cloud-finalize — this route never charges.
// See docs/superpowers/specs/2026-07-15-cloud-demo-build-design.md.
import { verifyIdToken, adminDb } from '@/lib/firebase/admin';
import { loadPeriodCreditsAdmin, ensureIngestTokenAdmin } from '@/lib/firebase/companyDataAdmin';
import { startCloudBuild } from '@/lib/build/cloudSandbox';
// Relative (not `@/`) for the modules this route does NOT mock in tests: vitest.config.ts
// has no tsconfig-paths plugin, so an unmocked `@/` value import fails to resolve under
// vitest (only mocked `@/` specifiers resolve, via vi.mock's interception) — see
// .superpowers/sdd/task-6-report.md's "Import-path note" for the same finding.
import { paths } from '../../../../lib/firebase/schema';
import { canAffordBuild, PRO_INCLUDED_CREDITS } from '../../../../lib/ai/credits';
import { cloudBuildScript } from '../../../../lib/build/cloudBuildScript';

export const runtime = 'nodejs';

interface CloudStartBody {
  plan?: { title: string; budgetActions?: number; steps?: string[] };
  brief?: string;
}

export async function POST(req: Request): Promise<Response> {
  // Paid API — require a valid Firebase ID token, same as /api/build-plan.
  const authz = req.headers.get('authorization') ?? '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  if (!idToken) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  let decoded;
  try {
    decoded = await verifyIdToken(idToken);
  } catch {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  // Scope every read/write to the verified token's uid (the app convention is
  // companyId === uid, per firestore.rules' `ownsByConvention`) — NEVER trust a
  // companyId from the request body, or a signed-in user could pass another
  // company's id and lock its builds / hijack its ingest token.
  const companyId = decoded.uid;

  if (!process.env.E2B_API_KEY || !process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'not_configured' }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const { plan, brief } = (body ?? {}) as CloudStartBody;
  if (!plan || typeof plan.title !== 'string' || typeof brief !== 'string') {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  // Credit gate — checked BEFORE booting anything, so an over-allowance company never
  // gets a sandbox started (no boot, no charge).
  const used = await loadPeriodCreditsAdmin(companyId);
  const allowance = PRO_INCLUDED_CREDITS;
  if (!canAffordBuild(used, allowance)) {
    return Response.json({ error: 'no_credits' }, { status: 402 });
  }

  // Single-flight — at most one live cloud build per company at a time.
  const db = adminDb();
  const activeSnap = await db
    .collection(paths.liveBuilds(companyId))
    .where('ended', '==', false)
    .where('mode', '==', 'cloud')
    .limit(1)
    .get();
  if (!activeSnap.empty) {
    return Response.json({ error: 'build_in_progress' }, { status: 409 });
  }

  const buildSessionId = crypto.randomUUID();
  const token = await ensureIngestTokenAdmin(companyId);

  const openingPrompt = `Let's build: ${plan.title}\nWhat to build: ${brief}`;
  const script = cloudBuildScript({
    openingPrompt,
    apiUrl: new URL(req.url).origin,
    companyId,
    token,
    buildSessionId,
  });

  try {
    await startCloudBuild({ script, anthropicKey: process.env.ANTHROPIC_API_KEY! });
  } catch (err) {
    console.error('[cloud-start] sandbox boot failed', err);
    return Response.json({ error: 'boot_failed' }, { status: 502 });
  }

  // Only written after a successful boot — never charges, never leaks a key/token.
  await db
    .doc(paths.liveBuild(companyId, buildSessionId))
    .set({ companyId, mode: 'cloud', ended: false, startedAt: Date.now() }, { merge: true });

  return Response.json({ buildSessionId });
}
