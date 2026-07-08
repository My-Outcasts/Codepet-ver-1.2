#!/usr/bin/env node
// Scan one or more local folders for git projects and sync the list to Codepet,
// so the Build Coach's "Which project?" picker shows your real local projects.
// Each project carries a compact brief (dependency names, folder names, README
// excerpt) so hosted Byte can brainstorm about the real codebase — source file
// contents are never sent.
//
// Usage:  node scripts/scan-projects.mjs <rootDir> [<rootDir> ...] [--depth N]
// Reuses the same per-company ingest token the tracker uses (read from
// <claudeDir>/codepet/track.json, written by the installer).
// See docs/superpowers/specs/2026-07-08-build-intake-project-scan-design.md.
import { findProjects } from '../lib/installer/scan.mjs';
import { summarizeProject } from '../lib/installer/projectBrief.mjs';
import { readTrackingConfig } from '../lib/installer/tracking.mjs';
import { resolveClaudeDir } from '../lib/installer/paths.mjs';

const argv = process.argv.slice(2);
const di = argv.indexOf('--depth');
const depth = di !== -1 ? Number(argv[di + 1]) : 2;
const roots = (di === -1 ? argv : argv.slice(0, di)).filter((a) => !a.startsWith('--'));

if (roots.length === 0) {
  console.error('Usage: node scripts/scan-projects.mjs <rootDir> [<rootDir> ...] [--depth N]');
  process.exit(2);
}

const cfg = readTrackingConfig(resolveClaudeDir());
if (!cfg?.companyId || !cfg?.token || !cfg?.apiUrl) {
  console.error(
    'No Codepet config found. Install the tracker first (First install / Settings) so the machine has a company ingest token.',
  );
  process.exit(1);
}

const projects = findProjects(roots, { maxDepth: Number.isFinite(depth) ? depth : 2 }).map((p) => ({
  ...p,
  brief: summarizeProject(p.path),
}));
console.log(`Found ${projects.length} project(s):`);
for (const p of projects) console.log(`  • ${p.name}  (${p.path})`);

const url = `${cfg.apiUrl.replace(/\/$/, '')}/api/projects`;
try {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ companyId: cfg.companyId, token: cfg.token, projects }),
  });
  if (!res.ok) {
    console.error(`Sync failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const data = await res.json().catch(() => ({}));
  console.log(`✓ Synced ${data.count ?? projects.length} project(s) to Codepet.`);
} catch (err) {
  console.error('Sync failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
}
