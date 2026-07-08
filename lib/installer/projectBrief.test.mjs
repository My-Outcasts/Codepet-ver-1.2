import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { summarizeProject, briefText } from './projectBrief.mjs';

function tmpProject(setup) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepet-brief-'));
  setup(dir);
  return dir;
}

test('summarizes package.json deps, README, and folder structure', () => {
  const dir = tmpProject((d) => {
    fs.writeFileSync(
      path.join(d, 'package.json'),
      JSON.stringify({
        dependencies: { next: '15', react: '19', stripe: '14' },
        devDependencies: { typescript: '5' },
      }),
    );
    fs.writeFileSync(path.join(d, 'README.md'), '# My App\n\nA **todo** app for students.\n');
    fs.mkdirSync(path.join(d, 'app', 'api'), { recursive: true });
    fs.mkdirSync(path.join(d, 'node_modules', 'x'), { recursive: true });
    fs.mkdirSync(path.join(d, '.git'));
  });
  const b = summarizeProject(dir);
  assert.ok(b.frameworks.includes('Next.js'));
  assert.ok(b.frameworks.includes('TypeScript'));
  assert.ok(b.deps.includes('stripe'));
  assert.ok(b.dirs.includes('app'));
  assert.ok(b.dirs.includes('app/api'));
  assert.ok(!b.dirs.some((x) => x.includes('node_modules')));
  assert.match(b.readme, /todo app for students/);
  assert.ok(!b.readme.includes('**'), 'markdown stripped');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an empty or unreadable directory yields an empty (but valid) brief', () => {
  const dir = tmpProject(() => {});
  const b = summarizeProject(dir);
  assert.deepEqual(b.frameworks, []);
  assert.deepEqual(b.deps, []);
  assert.deepEqual(b.dirs, []);
  assert.equal(b.readme, '');
  assert.equal(summarizeProject(path.join(dir, 'nope')).deps.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('briefText renders a bounded prompt blob and tolerates garbage', () => {
  const t = briefText({
    frameworks: ['Next.js'],
    deps: ['next', 'react'],
    dirs: ['app'],
    readme: 'hello',
  });
  assert.match(t, /Stack: Next\.js/);
  assert.match(t, /Dependencies: next, react/);
  assert.match(t, /README: hello/);
  assert.ok(t.length <= 1200);
  assert.equal(briefText(null), '');
  assert.equal(briefText('x'), '');
});
