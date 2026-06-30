import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCapability, buildInstallCommand } from './capability.mjs';

test('local by default', () => {
  assert.equal(detectCapability({}, () => '/home/u').mode, 'local');
});
test('remote for CODEPET_REMOTE=1', () => {
  assert.equal(detectCapability({ CODEPET_REMOTE: '1' }, () => '/home/u').mode, 'remote');
});
test('remote for VERCEL', () => {
  assert.equal(detectCapability({ VERCEL: '1' }, () => '/home/u').mode, 'remote');
});
test('remote when there is no home dir', () => {
  assert.equal(detectCapability({}, () => '').mode, 'remote');
});
test('buildInstallCommand emits the CLI line', () => {
  assert.equal(buildInstallCommand(['prd-writer', 'code-review']), 'node scripts/install-toolkit.mjs prd-writer code-review');
});
