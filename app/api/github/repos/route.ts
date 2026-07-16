// Lists the connected GitHub App installation's repos, and creates a new repo from the
// Codepet starter template. Same Firebase-ID-token + companyId=uid convention as
// /api/build/cloud-start — see that route's IDOR note for why companyId is never trusted
// from the request.
import { verifyIdToken } from '@/lib/firebase/admin';
import { getCompanyGithub, getCompanyGithubUserToken } from '@/lib/firebase/companyDataAdmin';
import {
  listInstallationRepos,
  createRepoFromTemplate,
  addRepoToInstallation,
} from '@/lib/github/repos';
import { sanitizeRepoName } from '@/lib/github/repoName';

export const runtime = 'nodejs';

async function requireCompanyId(req: Request): Promise<string | null> {
  const authz = req.headers.get('authorization') ?? '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  if (!idToken) return null;
  try {
    const decoded = await verifyIdToken(idToken);
    return decoded.uid;
  } catch {
    return null;
  }
}

export async function GET(req: Request): Promise<Response> {
  const companyId = await requireCompanyId(req);
  if (!companyId) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const gh = await getCompanyGithub(companyId);
  if (!gh) {
    return Response.json({ error: 'not_connected' }, { status: 404 });
  }

  const repos = await listInstallationRepos(gh.installationId);
  return Response.json({ repos });
}

export async function POST(req: Request): Promise<Response> {
  const companyId = await requireCompanyId(req);
  if (!companyId) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const name = sanitizeRepoName((body as { name?: unknown } | null)?.name);
  if (!name) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  // Repo creation is a *user* action (the repo is owned by whoever the stored GitHub user
  // access token authenticates as), so we need that token — not just an installation token.
  // If it isn't stored, the founder must (re)connect GitHub to grant it.
  const userToken = await getCompanyGithubUserToken(companyId);
  if (!userToken) {
    return Response.json({ error: 'reconnect_github' }, { status: 400 });
  }

  const gh = await getCompanyGithub(companyId);
  if (!gh) {
    return Response.json({ error: 'not_connected' }, { status: 404 });
  }

  let repo: { owner: string; name: string; id: number };
  try {
    repo = await createRepoFromTemplate(userToken, name);
  } catch {
    return Response.json({ error: 'create_failed' }, { status: 422 });
  }

  // The App may be installed on "select" repos, so a brand-new repo isn't covered until we
  // explicitly add it — otherwise the installation token can't reach it for cloud builds.
  try {
    await addRepoToInstallation(userToken, gh.installationId, repo.id);
  } catch {
    return Response.json({ error: 'coverage_failed' }, { status: 502 });
  }

  // Never leak the user token or the numeric repo id to the client.
  return Response.json({ repo: { owner: repo.owner, name: repo.name } });
}
