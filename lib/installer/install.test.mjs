import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installItems, uninstallItems, installedStatus } from './install.mjs';
import { validateIds, itemsByIds } from './manifest.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'codepet-claude-'));

test('installItems creates skill and agent files at derived paths', () => {
  const dir = tmp();
  const res = installItems(['prd-writer', 'test-writer'], dir);
  assert.equal(res[0].status, 'created');
  assert.equal(res[1].status, 'created');
  assert.ok(fs.existsSync(path.join(dir, 'skills', 'prd-writer', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(dir, 'agents', 'test-writer.md')));
});

test('installItems is idempotent (skipped on identical re-run)', () => {
  const dir = tmp();
  installItems(['prd-writer'], dir);
  assert.equal(installItems(['prd-writer'], dir)[0].status, 'skipped');
});

test('installItems reports updated when the target differs', () => {
  const dir = tmp();
  installItems(['prd-writer'], dir);
  fs.writeFileSync(path.join(dir, 'skills', 'prd-writer', 'SKILL.md'), 'changed');
  assert.equal(installItems(['prd-writer'], dir)[0].status, 'updated');
});

test('installedStatus reflects before/after install', () => {
  const dir = tmp();
  assert.equal(installedStatus(['code-review'], dir)[0].installed, false);
  installItems(['code-review'], dir);
  assert.equal(installedStatus(['code-review'], dir)[0].installed, true);
});

test('uninstallItems removes managed targets, then reports absent', () => {
  const dir = tmp();
  installItems(['prd-writer'], dir);
  assert.equal(uninstallItems(['prd-writer'], dir)[0].status, 'removed');
  assert.equal(fs.existsSync(path.join(dir, 'skills', 'prd-writer')), false);
  assert.equal(uninstallItems(['prd-writer'], dir)[0].status, 'absent');
});

test('itemsByIds throws on unknown id', () => {
  assert.throws(() => itemsByIds(['nope']), /Unknown toolkit id/);
});

test('validateIds rejects malformed or unknown ids, accepts known', () => {
  assert.throws(() => validateIds(['../etc']), /Invalid toolkit id/);
  assert.throws(() => validateIds(['unknown-skill']), /Invalid toolkit id/);
  assert.deepEqual(validateIds(['prd-writer']), ['prd-writer']);
});
