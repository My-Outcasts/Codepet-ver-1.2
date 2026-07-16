// Validate a repo name before creating it on GitHub. GitHub silently rewrites some names
// (spaces → hyphens, etc.); we reject up front so the created repo matches what the founder
// typed, and to keep the name safe as a path segment. Pure — unit-tested.
const RE = /^[A-Za-z0-9-_.]{1,100}$/;

export function sanitizeRepoName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  return RE.test(name) ? name : null;
}
