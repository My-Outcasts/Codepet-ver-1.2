// GitHub repo helpers for cloud builds. The pure ownership guard is the security boundary:
// a founder may only build into a repo their App installation actually covers. (HTTP list/
// create functions are added in a later task; this file starts with the guard.)

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
