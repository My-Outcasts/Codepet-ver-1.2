import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installTracking, readTrackingConfig, setTrackingEnabled } from './tracking.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'codepet-track-'));
const cfg = { companyId: 'c1', token: 'secret', apiUrl: 'https://codepet.app' };
const cfgPath = (dir) => path.join(dir, 'codepet', 'track.json');
const readCfg = (dir) => JSON.parse(fs.readFileSync(cfgPath(dir), 'utf8'));

test('installTracking writes the script, config, and registers the SessionEnd hook', () => {
  const dir = tmp();
  installTracking(dir, cfg);

  assert.ok(fs.existsSync(path.join(dir, 'codepet', 'codepet-track.mjs')), 'script copied');

  const written = readCfg(dir);
  assert.deepEqual(written, { ...cfg, enabled: true });

  const settings = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  const cmd = settings.hooks.SessionEnd[0].hooks[0].command;
  assert.match(cmd, /codepet-track\.mjs/);
});

test('installTracking defaults enabled:true but preserves an existing enabled flag', () => {
  const dir = tmp();
  installTracking(dir, cfg);
  setTrackingEnabled(dir, false);
  installTracking(dir, cfg); // reinstall must not silently re-enable
  assert.equal(readCfg(dir).enabled, false);
});

test('readTrackingConfig returns null when no config exists', () => {
  assert.equal(readTrackingConfig(tmp()), null);
});

test('readTrackingConfig returns null on corrupt JSON', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'codepet'), { recursive: true });
  fs.writeFileSync(cfgPath(dir), '{ not json');
  assert.equal(readTrackingConfig(dir), null);
});

test('readTrackingConfig returns the parsed config', () => {
  const dir = tmp();
  installTracking(dir, cfg);
  assert.deepEqual(readTrackingConfig(dir), { ...cfg, enabled: true });
});

test('setTrackingEnabled flips the flag while preserving other fields', () => {
  const dir = tmp();
  installTracking(dir, cfg);

  setTrackingEnabled(dir, false);
  assert.deepEqual(readCfg(dir), { ...cfg, enabled: false });

  setTrackingEnabled(dir, true);
  assert.deepEqual(readCfg(dir), { ...cfg, enabled: true });
});

test('setTrackingEnabled throws when no config is installed', () => {
  assert.throws(() => setTrackingEnabled(tmp(), false), /not installed|no.*config/i);
});

test('installTracking is idempotent — re-running does not duplicate the hook', () => {
  const dir = tmp();
  installTracking(dir, cfg);
  installTracking(dir, cfg);
  const settings = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  assert.equal(settings.hooks.SessionEnd.length, 1);
});

test('installTracking preserves pre-existing settings.json content', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ model: 'opus' }));
  installTracking(dir, cfg);
  const settings = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  assert.equal(settings.model, 'opus');
  assert.equal(settings.hooks.SessionEnd.length, 1);
});

test('installTracking installs the live emitter script and its three hooks', () => {
  const dir = tmp();
  installTracking(dir, cfg);
  assert.ok(
    fs.existsSync(path.join(dir, 'codepet', 'codepet-live.mjs')),
    'live script copied',
  );
  const settings = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  for (const evt of ['SessionStart', 'PostToolUse', 'Stop']) {
    const cmds = (settings.hooks[evt] ?? []).flatMap((g) => g.hooks.map((h) => h.command));
    assert.ok(
      cmds.some((c) => c.includes('codepet-live.mjs')),
      `${evt} hook registers codepet-live.mjs`,
    );
  }
});

test('installTracking live hooks are idempotent — re-running does not duplicate', () => {
  const dir = tmp();
  installTracking(dir, cfg);
  installTracking(dir, cfg);
  const settings = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  for (const evt of ['SessionStart', 'PostToolUse', 'Stop']) {
    assert.equal(settings.hooks[evt].length, 1, `${evt} not duplicated`);
  }
});
