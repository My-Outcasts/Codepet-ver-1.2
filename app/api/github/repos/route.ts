// Lists the connected GitHub App installation's repos, and (eventually) creates a new repo
// from the Codepet starter template. Same Firebase-ID-token + companyId=uid convention as
// /api/build/cloud-start — see that route's IDOR note for why companyId is never trusted
// from the request.
import { verifyIdToken } from '@/lib/firebase/admin';
import { getCompanyGithub } from '@/lib/firebase/companyDataAdmin';
// createRepoFromTemplate is imported (not yet called) for the later Phase where a GitHub
// user access token is stored per-company — see the POST handler's 501 stub below.
import { listInstallationRepos, createRepoFromTemplate } from '@/lib/github/repos';

export const runtime = 'nodejs';

void createRepoFromTemplate; // referenced only to keep the import alive until Phase 2 wires it up

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

interface CreateRepoBody {
  name?: string;
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
  const { name } = (body ?? {}) as CreateRepoBody;
  if (!name || !name.trim()) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  // Phase 1 stub: creating a repo from the template needs a GitHub *user* access token,
  // which isn't stored yet (the App installation flow only gives us an installation
  // token, scoped to installation-owned actions — not repo creation on the user's
  // behalf). Rather than call createRepoFromTemplate with a token we don't have, return
  // a clean, honest 501 so the client can steer founders to "connect an existing repo"
  // instead. Wire this up for real once the user-token flow lands.
  return Response.json(
    {
      error: 'create_not_available',
      message: 'Repo creation is coming soon — connect an existing repo for now.',
    },
    { status: 501 },
  );
}
