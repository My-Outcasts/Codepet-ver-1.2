import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeHook } from './settings.mjs';

const entry = { type: 'command', command: 'node ~/.claude/codepet/codepet-track.mjs' };

test('mergeHook adds the hook to empty settings', () => {
  const out = mergeHook({}, 'SessionEnd', entry);
  assert.deepEqual(out.hooks.SessionEnd, [{ hooks: [entry] }]);
});

test('mergeHook is idempotent — same command is not added twice', () => {
  const once = mergeHook({}, 'SessionEnd', entry);
  const twice = mergeHook(once, 'SessionEnd', entry);
  assert.equal(twice.hooks.SessionEnd.length, 1);
  assert.equal(twice.hooks.SessionEnd[0].hooks.length, 1);
});

test('mergeHook preserves unrelated settings and other hook events', () => {
  const base = {
    model: 'sonnet',
    hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'x' }] }] },
  };
  const out = mergeHook(base, 'SessionEnd', entry);
  assert.equal(out.model, 'sonnet');
  assert.equal(out.hooks.PreToolUse.length, 1);
  assert.equal(out.hooks.SessionEnd.length, 1);
});

test('mergeHook does not mutate the input object', () => {
  const base = {};
  mergeHook(base, 'SessionEnd', entry);
  assert.deepEqual(base, {});
});
