// Pure builder for the bash script an E2B sandbox runs to produce a real-repo build.
// Mirrors cloudBuildScript.ts, but instead of seeding a throwaway demo dir it clones the
// tenant's actual GitHub repo (via a short-lived GitHub App installation token), works on
// a dedicated `codepet/<buildSessionId>` branch, runs claude watch-only streaming
// stream-json → self-reports each line to /api/track/live, caps tokens, commits + pushes
// the branch, and on exit finalizes (opens the PR, reports tokens) via
// /api/build/repo-finalize. All ids/tokens/apiUrl are baked in as env for the sandbox's
// cloud-run.mjs runner; the company ANTHROPIC_API_KEY and the GitHub App private key never
// appear in the script text — only the already-minted installation token does. No I/O —
// unit-tested.

export const REPO_BUILD_TOKEN_CAP = 3_000_000;

// Endpoints the sandbox runner calls (embedded so the launcher documents them).
const LIVE_PATH = '/api/track/live';
const FINALIZE_PATH = '/api/build/repo-finalize';

// The exact `claude` invocation the runner spawns: watch-only (never AskUserQuestion — see
// buildOpeningPrompt's non-interactive closing in armSession.ts), streaming stream-json
// events (self-reported line-by-line to LIVE_PATH), and permissions pre-approved since this
// only ever touches the cloned working-copy on a fresh branch (never main/master directly).
const CLAUDE_CMD = 'claude -p --output-format stream-json --permission-mode bypassPermissions';

const REPO_WORK_DIR = '/home/user/codepet-repo';

/** POSIX single-quote a value for safe embedding in the script. */
function shq(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`;
}

export interface RepoBuildInput {
  openingPrompt: string;
  apiUrl: string;
  companyId: string;
  ingestToken: string;
  buildSessionId: string;
  repo: { owner: string; name: string };
  installToken: string;
  tokenCap?: number;
}

export function repoBuildScript(input: RepoBuildInput): string {
  const { openingPrompt, apiUrl, companyId, ingestToken, buildSessionId, repo, installToken } =
    input;
  const cap = input.tokenCap ?? REPO_BUILD_TOKEN_CAP;
  const repoSlug = `${repo.owner}/${repo.name}`;
  const branch = `codepet/${buildSessionId}`;
  // Installation token is baked into the clone URL (over HTTPS, scoped, short-lived) so no
  // GitHub credential helper or App private key is ever needed inside the sandbox.
  const cloneUrl = `https://x-access-token:${installToken}@github.com/${repoSlug}.git`;
  // The runner script (node) lives in the sandbox template as /home/user/cloud-run.mjs; for
  // the repo-build path it: clones the repo, checks out the codepet/<id> branch, spawns
  // claude with stream-json, POSTs each event to /api/track/live, tracks the running token
  // total (kills claude past the cap), commits + pushes, opens the PR, and on exit POSTs
  // the PR URL + total tokens to /api/build/repo-finalize. Passing config via env keeps the
  // script flat and keeps user-controlled values (prompt/ids/token) out of argv/ps.
  return [
    'set -e',
    `mkdir -p ${shq(REPO_WORK_DIR)}`,
    `git clone ${shq(cloneUrl)} ${shq(REPO_WORK_DIR)}`,
    `cd ${shq(REPO_WORK_DIR)}`,
    `git checkout -b ${shq(branch)}`,
    // Config for the runner (env, not argv, so nothing leaks into ps for other tenants).
    `export CODEPET_API_URL=${shq(apiUrl)}`,
    `export CODEPET_COMPANY_ID=${shq(companyId)}`,
    `export CODEPET_INGEST_TOKEN=${shq(ingestToken)}`,
    `export CODEPET_BUILD_SESSION_ID=${shq(buildSessionId)}`,
    `export CODEPET_REPO=${shq(repoSlug)}`,
    `export CODEPET_BRANCH=${shq(branch)}`,
    `export CODEPET_INSTALL_TOKEN=${shq(installToken)}`,
    `export CODEPET_TOKEN_CAP=${cap}`,
    `export CODEPET_OPENING_PROMPT=${shq(openingPrompt)}`,
    `export CODEPET_CLAUDE_CMD=${shq(CLAUDE_CMD)}`,
    `export CODEPET_LIVE_PATH=${shq(LIVE_PATH)}`,
    `export CODEPET_FINALIZE_PATH=${shq(FINALIZE_PATH)}`,
    // The runner installs its own SIGINT/EXIT trap to always finalize (push + open PR +
    // report tokens); still guard here in case the runner itself never starts.
    `trap 'node /home/user/cloud-run.mjs --finalize-only' EXIT`,
    'node /home/user/cloud-run.mjs',
  ].join('\n');
}
