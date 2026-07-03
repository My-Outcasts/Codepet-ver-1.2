#!/usr/bin/env node
import { installItems } from '../lib/installer/install.mjs';
import { installTracking } from '../lib/installer/tracking.mjs';
import { resolveClaudeDir } from '../lib/installer/paths.mjs';
import { validateIds, ALL_IDS } from '../lib/installer/manifest.mjs';

// Args: <id...> [--track <companyId> <token> <apiUrl>]
const raw = process.argv.slice(2);
const ti = raw.indexOf('--track');
const idArgs = ti === -1 ? raw : raw.slice(0, ti);
const trackArgs = ti === -1 ? [] : raw.slice(ti + 1);

let valid;
try {
  valid = validateIds(idArgs.length ? idArgs : ALL_IDS);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(2);
}

const claudeDir = resolveClaudeDir();
const results = installItems(valid, claudeDir);
for (const r of results) {
  const mark = r.status === 'error' ? '✗' : '✓';
  const detail = r.status === 'error' ? `ERROR: ${r.error}` : r.status;
  console.log(`${mark} ${r.name} [${r.type}] → ${r.target} (${detail})`);
}

if (trackArgs.length >= 3) {
  const [companyId, token, apiUrl] = trackArgs;
  try {
    const paths = installTracking(claudeDir, { companyId, token, apiUrl });
    console.log(`✓ Activity tracker → ${paths.script} (SessionEnd hook installed)`);
  } catch (e) {
    console.error(`✗ Activity tracker: ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log(`\nClaude dir: ${claudeDir}`);
process.exit(results.some((r) => r.status === 'error') ? 1 : 0);
