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
  assert.equal(
    buildInstallCommand(['prd-writer', 'code-review']),
    'node scripts/install-toolkit.mjs prd-writer code-review',
  );
});

test('buildInstallCommand appends --track flags when tracking is provided', () => {
  assert.equal(
    buildInstallCommand(['prd-writer'], {
      companyId: 'c1',
      token: 'secret',
      apiUrl: 'https://codepet.app',
    }),
    'node scripts/install-toolkit.mjs prd-writer --track c1 secret https://codepet.app',
  );
});

test('buildInstallCommand omits --track when tracking is incomplete', () => {
  assert.equal(
    buildInstallCommand(['prd-writer'], { companyId: 'c1', token: '', apiUrl: 'https://x' }),
    'node scripts/install-toolkit.mjs prd-writer',
  );
});
