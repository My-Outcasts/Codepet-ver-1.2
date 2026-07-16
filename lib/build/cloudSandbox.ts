// Server-only: boots an E2B sandbox from the `codepet-build` template (docs/e2b-template.md),
// writes the launcher script cloudBuildScript produced, and runs it detached — the caller
// (the /api/build/cloud route, Task 6) gets the sandboxId back immediately and never waits
// on the build itself. The sandbox self-reports progress to /api/track/live and finalizes
// to /api/build/cloud-finalize; E2B tears the sandbox down at TIMEOUT_MS regardless.
import 'server-only';
import { Sandbox } from 'e2b';
import { BUILD_TOKEN_CAP } from './cloudBuildScript';

const TEMPLATE = 'codepet-build'; // built per docs/e2b-template.md (has node + claude)
const TIMEOUT_MS = 8 * 60_000;

/** Boot a sandbox, run the build script detached, and return without waiting. The
 *  sandbox self-reports to /api/track/live and finalizes to /api/build/cloud-finalize;
 *  E2B tears it down at TIMEOUT_MS. */
export async function startCloudBuild(input: {
  script: string;
  anthropicKey: string;
}): Promise<{ sandboxId: string }> {
  const sandbox = await Sandbox.create(TEMPLATE, {
    apiKey: process.env.E2B_API_KEY,
    timeoutMs: TIMEOUT_MS,
    envs: { ANTHROPIC_API_KEY: input.anthropicKey, CODEPET_TOKEN_CAP: String(BUILD_TOKEN_CAP) },
  });
  // Write the launcher, then run it detached (nohup + background) so the sandbox's own
  // process tracking doesn't hold this request open for the build's full duration.
  await sandbox.files.write('/home/user/launch.sh', input.script);
  await sandbox.commands.run('nohup bash /home/user/launch.sh >/tmp/build.log 2>&1 &', {
    background: true,
  });
  return { sandboxId: sandbox.sandboxId };
}
