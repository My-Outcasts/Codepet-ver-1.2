// Pure builder for the bash script an E2B sandbox runs to produce a demo build. Mirrors
// demoTerminalCommand (lib/armSession.ts) but self-contained for the cloud: seed → run
// claude watch-only, streaming stream-json → self-report each line to /api/track/live,
// cap tokens, then finalize (built files + tokens) on exit via a trap. All ids/token/
// apiUrl are baked in; the company ANTHROPIC_API_KEY comes from the sandbox ENV, never
// the script text. No I/O — unit-tested.
import { DEMO_SEED_HTML } from '../armSession';

export const DEMO_DIR_CLOUD = '/home/user/codepet-demo';
export const BUILD_TOKEN_CAP = 1_500_000;

// Endpoints the sandbox runner calls (embedded so the launcher documents them).
const LIVE_PATH = '/api/track/live';
const FINALIZE_PATH = '/api/build/cloud-finalize';

// The exact `claude` invocation the runner spawns: watch-only (never AskUserQuestion —
// see buildOpeningPrompt's non-interactive closing in armSession.ts), streaming
// stream-json events (self-reported line-by-line to LIVE_PATH), and permissions
// pre-approved since this only ever touches the throwaway sandboxed demo dir.
const CLAUDE_CMD = 'claude -p --output-format stream-json --permission-mode bypassPermissions';

/** POSIX single-quote a value for safe embedding in the script. */
function shq(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`;
}

export interface CloudBuildInput {
  openingPrompt: string;
  apiUrl: string;
  companyId: string;
  token: string;
  buildSessionId: string;
  tokenCap?: number;
}

export function cloudBuildScript(input: CloudBuildInput): string {
  const { openingPrompt, apiUrl, companyId, token, buildSessionId } = input;
  const cap = input.tokenCap ?? BUILD_TOKEN_CAP;
  // Reuse the single demo landing-page seed (shared with the local/remote demo path) so
  // the two can't drift.
  const seed = DEMO_SEED_HTML;
  // The runner script (node) lives in the sandbox template as /home/user/cloud-run.mjs;
  // it: spawns claude with stream-json, POSTs each event to /api/track/live, tracks the
  // running token total (kills claude past the cap), and on exit POSTs the built files +
  // total tokens to /api/build/cloud-finalize. Passing config via env keeps the script flat.
  return [
    'set -e',
    `mkdir -p ${shq(DEMO_DIR_CLOUD)}`,
    `cd ${shq(DEMO_DIR_CLOUD)}`,
    `[ -f index.html ] || printf '%s' ${shq(seed)} > index.html`,
    // Config for the runner (env, not argv, so nothing leaks into ps for other tenants).
    `export CODEPET_API_URL=${shq(apiUrl)}`,
    `export CODEPET_COMPANY_ID=${shq(companyId)}`,
    `export CODEPET_INGEST_TOKEN=${shq(token)}`,
    `export CODEPET_BUILD_SESSION_ID=${shq(buildSessionId)}`,
    `export CODEPET_TOKEN_CAP=${cap}`,
    `export CODEPET_OPENING_PROMPT=${shq(openingPrompt)}`,
    `export CODEPET_DEMO_DIR=${shq(DEMO_DIR_CLOUD)}`,
    `export CODEPET_CLAUDE_CMD=${shq(CLAUDE_CMD)}`,
    `export CODEPET_LIVE_PATH=${shq(LIVE_PATH)}`,
    `export CODEPET_FINALIZE_PATH=${shq(FINALIZE_PATH)}`,
    // The runner installs its own SIGINT/EXIT trap to always finalize; still guard here.
    `trap 'node /home/user/cloud-run.mjs --finalize-only' EXIT`,
    `node /home/user/cloud-run.mjs`,
  ].join('\n');
}
