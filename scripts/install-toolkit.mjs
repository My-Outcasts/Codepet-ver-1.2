#!/usr/bin/env node
import { installItems } from '../lib/installer/install.mjs';
import { resolveClaudeDir } from '../lib/installer/paths.mjs';
import { validateIds, ALL_IDS } from '../lib/installer/manifest.mjs';

const args = process.argv.slice(2);
let valid;
try {
  valid = validateIds(args.length ? args : ALL_IDS);
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
console.log(`\nClaude dir: ${claudeDir}`);
process.exit(results.some((r) => r.status === 'error') ? 1 : 0);
