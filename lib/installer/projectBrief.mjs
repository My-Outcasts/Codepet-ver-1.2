// Compact per-project summary ("brief") shared by the scan CLI and the server
// action, so Byte can brainstorm about the founder's REAL codebase. Reads only
// safe, cheap signals: package.json dependency names, the first lines of the
// README, and top-2-level folder names. Never uploads source file contents.
// See docs/superpowers/specs/2026-07-08-build-intake-project-scan-design.md.
import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'out',
  'coverage',
  '.turbo',
  '.cache',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
]);

const MAX_DEPS = 16;
const MAX_DIRS = 16;
const MAX_README = 400;

/** Framework/stack hints from dependency names — plain words a founder knows. */
const FRAMEWORK_HINTS = [
  ['next', 'Next.js'],
  ['react-native', 'React Native'],
  ['react', 'React'],
  ['vue', 'Vue'],
  ['svelte', 'Svelte'],
  ['express', 'Express'],
  ['fastify', 'Fastify'],
  ['firebase', 'Firebase'],
  ['firebase-admin', 'Firebase'],
  ['stripe', 'Stripe'],
  ['tailwindcss', 'Tailwind'],
  ['typescript', 'TypeScript'],
  ['vitest', 'Vitest'],
  ['electron', 'Electron'],
];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readReadme(dir) {
  for (const name of ['README.md', 'readme.md', 'README.txt', 'README']) {
    try {
      const raw = fs.readFileSync(path.join(dir, name), 'utf8');
      return raw
        .split('\n')
        .slice(0, 12)
        .join('\n')
        .replace(/[#*_`>]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_README);
    } catch {
      // try the next candidate
    }
  }
  return '';
}

function listDirs(dir) {
  const out = [];
  let top;
  try {
    top = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of top) {
    if (!e.isDirectory() || SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
    out.push(e.name);
    // One level deeper, prefixed, so "app/api" style structure shows.
    try {
      for (const sub of fs.readdirSync(path.join(dir, e.name), { withFileTypes: true })) {
        if (!sub.isDirectory() || SKIP_DIRS.has(sub.name) || sub.name.startsWith('.')) continue;
        out.push(`${e.name}/${sub.name}`);
        if (out.length >= MAX_DIRS) return out;
      }
    } catch {
      // unreadable subdir — skip
    }
    if (out.length >= MAX_DIRS) return out;
  }
  return out;
}

/** Summarize one project directory. Never throws; missing pieces come back empty. */
export function summarizeProject(dir) {
  const pkg = readJson(path.join(dir, 'package.json'));
  const depNames = pkg
    ? Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) })
    : [];
  const frameworks = [];
  for (const [dep, label] of FRAMEWORK_HINTS) {
    if (depNames.includes(dep) && !frameworks.includes(label)) frameworks.push(label);
  }
  return {
    frameworks,
    deps: depNames.slice(0, MAX_DEPS),
    dirs: listDirs(dir),
    readme: readReadme(dir),
    scannedAt: Date.now(),
  };
}

/** Prompt-ready one-blob text for a brief (bounded); '' when there's nothing. */
export function briefText(brief) {
  if (!brief || typeof brief !== 'object') return '';
  const parts = [];
  if (Array.isArray(brief.frameworks) && brief.frameworks.length)
    parts.push(`Stack: ${brief.frameworks.join(', ')}`);
  if (Array.isArray(brief.deps) && brief.deps.length)
    parts.push(`Dependencies: ${brief.deps.join(', ')}`);
  if (Array.isArray(brief.dirs) && brief.dirs.length)
    parts.push(`Folders: ${brief.dirs.join(', ')}`);
  if (typeof brief.readme === 'string' && brief.readme) parts.push(`README: ${brief.readme}`);
  return parts.join('\n').slice(0, 1200);
}
