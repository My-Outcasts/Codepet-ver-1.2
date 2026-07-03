import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findProjects } from './scan.mjs';

// Build a temp directory tree; each "repo" is a folder containing a .git dir.
function tree(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codepet-scan-'));
  for (const rel of spec) fs.mkdirSync(path.join(root, rel), { recursive: true });
  return root;
}
const names = (list) => list.map((p) => p.name).sort();

test('finds git repos within the depth limit', () => {
  const root = tree([
    'proj-a/.git', // depth 1 repo
    'group/proj-b/.git', // depth 2 repo
    'plain/src', // no .git → not a repo
  ]);
  assert.deepEqual(names(findProjects(root, { maxDepth: 2 })), ['proj-a', 'proj-b']);
});

test('does not descend into a repo (no nested repos)', () => {
  const root = tree(['proj-a/.git', 'proj-a/inner/.git']);
  assert.deepEqual(names(findProjects(root, { maxDepth: 3 })), ['proj-a']);
});

test('skips node_modules and hidden folders', () => {
  const root = tree(['node_modules/pkg/.git', '.cache/thing/.git', 'real/.git']);
  assert.deepEqual(names(findProjects(root, { maxDepth: 3 })), ['real']);
});

test('respects maxDepth — repos deeper than the limit are ignored', () => {
  const root = tree(['a/b/c/deep/.git']);
  assert.deepEqual(findProjects(root, { maxDepth: 2 }), []);
});

test('returns repo path as well as name', () => {
  const root = tree(['proj-a/.git']);
  const [p] = findProjects(root, { maxDepth: 1 });
  assert.equal(p.name, 'proj-a');
  assert.equal(p.path, path.join(root, 'proj-a'));
});

test('dedupes a repo reached via two roots', () => {
  const root = tree(['proj-a/.git']);
  const out = findProjects([root, root], { maxDepth: 1 });
  assert.equal(out.length, 1);
});

test('ignores roots that do not exist', () => {
  assert.deepEqual(findProjects('/no/such/dir/here', { maxDepth: 2 }), []);
});
