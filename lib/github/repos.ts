// GitHub repo helpers for cloud builds. The pure ownership guard is the security boundary:
// a founder may only build into a repo their App installation actually covers.
import 'server-only';
import { installationToken } from './appAuth';

export interface RepoRef {
  owner: string;
  name: string;
}

/** Case-insensitive membership: is `target` one of the installation's repos? */
export function repoInInstallation(repos: RepoRef[], target: RepoRef): boolean {
  if (!target.owner || !target.name) return false;
  const key = (r: RepoRef) => `${r.owner.toLowerCase()}/${r.name.toLowerCase()}`;
  const want = key(target);
  return repos.some((r) => key(r) === want);
}

/** Template repo cloud builds are generated from. */
export const CODEPET_TEMPLATE = 'codepet-templates/starter';

/**
 * List every repo the App installation covers. Mints an all-repos installation
 * token (empty `repositories` scope), then lists via the installation-scoped
 * endpoint.
 *
 * NOTE: only the first page (up to 100 repos) is fetched — fine for Phase 1
 * installations, which are expected to cover a handful of repos. Revisit with
 * proper pagination if that assumption stops holding.
 *
 * SECURITY: never log the minted token.
 */
export async function listInstallationRepos(installationId: string): Promise<RepoRef[]> {
  const instToken = await installationToken(installationId, []);
  const resp = await fetch('https://api.github.com/installation/repositories?per_page=100', {
    headers: {
      Authorization: `token ${instToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!resp.ok) {
    throw new Error(`GitHub installation repos request failed: ${resp.status}`);
  }
  const data = (await resp.json()) as {
    repositories: { owner: { login: string }; name: string }[];
  };
  return data.repositories.map((r) => ({ owner: r.owner.login, name: r.name }));
}

/**
 * Generate a new repo from the Codepet starter template, owned by whoever
 * `userToken` authenticates as. Used for the "create a new project" cloud-build flow.
 *
 * SECURITY: never log `userToken`.
 */
export async function createRepoFromTemplate(userToken: string, name: string): Promise<RepoRef> {
  const resp = await fetch(`https://api.github.com/repos/${CODEPET_TEMPLATE}/generate`, {
    method: 'POST',
    headers: {
      Authorization: `token ${userToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, private: true }),
  });
  if (!resp.ok) {
    throw new Error(`GitHub create-repo-from-template request failed: ${resp.status}`);
  }
  const data = (await resp.json()) as { owner: { login: string }; name: string };
  return { owner: data.owner.login, name: data.name };
}
