// Pure directory-walk that finds local git projects under one or more root
// folders. Framework-free and unit-tested (lib/installer/scan.test.mjs). The
// scan CLI (scripts/scan-projects.mjs) feeds the result to POST /api/projects,
// which populates the Build Coach's "Which project?" picker. Only folder names
// and paths are collected — never file contents.
// See docs/superpowers/specs/2026-07-02-local-project-scan-design.md.
import fs from 'node:fs';
import path from 'node:path';

// Folders that never contain a project worth listing (and would slow the walk).
const SKIP = new Set(['node_modules', 'dist', 'build', '.next', '.cache', 'vendor', 'target']);

/**
 * Find git repositories under the given root(s).
 * @param {string|string[]} roots  One or more directories to scan.
 * @param {{maxDepth?: number}} [opts]  How many levels below each root to descend (default 2).
 * @returns {{name: string, path: string}[]}  Distinct repos, in discovery order.
 */
export function findProjects(roots, { maxDepth = 2 } = {}) {
  const list = Array.isArray(roots) ? roots : [roots];
  const out = [];
  const seen = new Set();

  const walk = (dir, depth) => {
    // A folder containing .git is a repo — record it and stop (don't nest).
    if (fs.existsSync(path.join(dir, '.git'))) {
      const abs = path.resolve(dir);
      if (!seen.has(abs)) {
        seen.add(abs);
        out.push({ name: path.basename(abs), path: abs });
      }
      return;
    }
    if (depth >= maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable / nonexistent dir — skip
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  };

  for (const root of list) walk(root, 0);
  return out;
}
