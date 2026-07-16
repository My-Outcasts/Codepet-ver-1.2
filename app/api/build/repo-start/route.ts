// GitHub-backed cloud build — like /api/build/cloud-start but boots into a real,
// founder-owned GitHub repo instead of an ephemeral demo dir. Every step up through the
// credit gate mirrors cloud-start (see that file's comments for the full IDOR
// rationale); this route adds the GitHub-specific ownership guard: a company may only
// build into a repo its OWN GitHub App installation actually covers — never trust
// owner/name from the request body beyond that check, since a signed-in founder could
// otherwise point a build at a repo they don't own.
// See docs/superpowers/specs/2026-07-15-github-backed-cloud-build-design.md.
import { verifyIdToken, adminDb } from '@/lib/firebase/admin';
import {
  loadPeriodCreditsAdmin,
  ensureIngestTokenAdmin,
  getCompanyGithub,
} from '@/lib/firebase/companyDataAdmin';
import { startCloudBuild } from '@/lib/build/cloudSandbox';
import { installationToken } from '@/lib/github/appAuth';
import { listInstallationRepos, repoInInstallation, type RepoRef } from '@/lib/github/repos';
// Relative (not `@/`) for the modules this route does NOT mock in tests: vitest.config.ts
// has no tsconfig-paths plugin, so an unmocked `@/` value import fails to resolve under
// vitest (only mocked `@/` specifiers resolve, via vi.mock's interception) — see
// cloud-start/route.ts's identical note and .superpowers/sdd/task-6-report.md.
import { paths } from '../../../../lib/firebase/schema';
import { canAffordBuild, PRO_INCLUDED_CREDITS } from '../../../../lib/ai/credits';
import { repoBuildScript } from '../../../../lib/build/repoBuildScript';

export const runtime = 'nodejs';

interface RepoStartBody {
  repo?: { owner?: string; name?: string };
  plan?: { title: string; budgetActions?: number; steps?: string[] };
  brief?: string;
}

export async function POST(req: Request): Promise<Response> {
  // Paid API — require a valid Firebase ID token, same as /api/build/cloud-start.
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
  // Scope every read/write to the verified token's uid (companyId === uid, per
  // firestore.rules' `ownsByConvention`) — NEVER trust a companyId from the request
  // body, or a signed-in user could pass another company's id and hijack its GitHub
  // connection, its credits, or its ingest token.
  const companyId = decoded.uid;

  if (
    !process.env.E2B_API_KEY ||
    !process.env.ANTHROPIC_API_KEY ||
    !process.env.GITHUB_APP_ID ||
    !process.env.GITHUB_APP_PRIVATE_KEY
  ) {
    return Response.json({ error: 'not_configured' }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const { repo, plan, brief } = (body ?? {}) as RepoStartBody;
  if (!plan || typeof plan.title !== 'string' || typeof brief !== 'string') {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  if (
    !repo ||
    typeof repo.owner !== 'string' ||
    !repo.owner ||
    typeof repo.name !== 'string' ||
    !repo.name
  ) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  // Sanitized to exactly {owner, name} — never forward extra client-supplied fields
  // into the sandbox script or the Firestore doc.
  const targetRepo: RepoRef = { owner: repo.owner, name: repo.name };

  // Credit gate — checked BEFORE any GitHub call or sandbox boot, so an over-allowance
  // company never triggers a token mint or a boot (no boot, no charge).
  const used = await loadPeriodCreditsAdmin(companyId);
  if (!canAffordBuild(used, PRO_INCLUDED_CREDITS)) {
    return Response.json({ error: 'no_credits' }, { status: 402 });
  }

  const gh = await getCompanyGithub(companyId);
  if (!gh) {
    return Response.json({ error: 'not_connected' }, { status: 404 });
  }

  // OWNERSHIP GUARD — the security boundary of this route. A company may only build
  // into a repo its OWN App installation actually covers; a well-formed repo the
  // caller doesn't own must 403 here, never fall through to booting a sandbox with a
  // token scoped to somebody else's repo.
  const repos = await listInstallationRepos(gh.installationId);
  if (!repoInInstallation(repos, targetRepo)) {
    return Response.json({ error: 'repo_not_owned' }, { status: 403 });
  }

  // Single-flight — at most one live repo build per company at a time. A single
  // equality `where` needs no composite Firestore index (a two-equality where would);
  // filter `mode === 'repo'` in code over the (small) set of not-yet-ended builds
  // (mirrors cloud-start's single-flight check).
  const db = adminDb();
  const activeSnap = await db
    .collection(paths.liveBuilds(companyId))
    .where('ended', '==', false)
    .get();
  const hasActiveRepoBuild = activeSnap.docs.some((d) => d.data()?.mode === 'repo');
  if (hasActiveRepoBuild) {
    return Response.json({ error: 'build_in_progress' }, { status: 409 });
  }

  // Scoped to just this repo (not the whole installation) — least privilege for the
  // token that gets baked into the sandbox's clone URL.
  const instToken = await installationToken(gh.installationId, [targetRepo.name]);
  const token = await ensureIngestTokenAdmin(companyId);
  const buildSessionId = crypto.randomUUID();

  const openingPrompt = `Let's build: ${plan.title}\nWhat to build: ${brief}`;
  const script = repoBuildScript({
    openingPrompt,
    apiUrl: new URL(req.url).origin,
    companyId,
    ingestToken: token,
    buildSessionId,
    repo: targetRepo,
    installToken: instToken,
  });

  try {
    await startCloudBuild({ script, anthropicKey: process.env.ANTHROPIC_API_KEY! });
  } catch (err) {
    console.error('[repo-start] sandbox boot failed', err);
    return Response.json({ error: 'boot_failed' }, { status: 502 });
  }

  // Only written after a successful boot — never charges, never leaks a key/token.
  await db
    .doc(paths.liveBuild(companyId, buildSessionId))
    .set(
      { companyId, mode: 'repo', repo: targetRepo, ended: false, startedAt: Date.now() },
      { merge: true },
    );

  return Response.json({ buildSessionId });
}
