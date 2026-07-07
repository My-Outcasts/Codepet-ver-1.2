import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toDecisionResult,
  allowResult,
  denyResult,
  denyNudge,
  parsePermissionInput,
  requestBody,
} from './permissionServer.mjs';

test('parsePermissionInput reads the real CLI contract (input under `input`)', () => {
  // The live --permission-prompt-tool call sends arguments as
  // { tool_name, input, tool_use_id } — the tool args live under `input`.
  assert.deepEqual(
    parsePermissionInput({
      tool_name: 'AskUserQuestion',
      input: { questions: [{ question: 'red or blue?' }] },
      tool_use_id: 'toolu_1',
    }),
    { tool: 'AskUserQuestion', input: { questions: [{ question: 'red or blue?' }] } },
  );
});

test('parsePermissionInput still accepts the legacy tool_input key', () => {
  assert.deepEqual(parsePermissionInput({ tool_name: 'Bash', tool_input: { command: 'ls' } }), {
    tool: 'Bash',
    input: { command: 'ls' },
  });
});

test('parsePermissionInput falls back safely on odd input', () => {
  assert.deepEqual(parsePermissionInput(null), { tool: 'unknown', input: null });
  assert.deepEqual(parsePermissionInput({}), { tool: 'unknown', input: null });
});

test('toDecisionResult wraps a result as an MCP text result', () => {
  const r = toDecisionResult({ behavior: 'allow', updatedInput: {} });
  assert.equal(r.content[0].type, 'text');
  assert.deepEqual(JSON.parse(r.content[0].text), { behavior: 'allow', updatedInput: {} });
});

test('allowResult carries updatedInput in the behavior shape', () => {
  assert.deepEqual(JSON.parse(allowResult({ command: 'ls' }).content[0].text), {
    behavior: 'allow',
    updatedInput: { command: 'ls' },
  });
});

test('denyResult is a deny behavior result with a message', () => {
  assert.deepEqual(JSON.parse(denyResult('bridge down').content[0].text), {
    behavior: 'deny',
    message: 'bridge down',
  });
});

test('denyNudge turns a decline into a keep-going instruction, never a bare Denied', () => {
  const timeout = denyNudge('timed out');
  assert.match(timeout, /respond/i);
  assert.match(timeout, /continue|summar/i);

  const declined = denyNudge('user declined');
  assert.match(declined, /declined|decline/i);
  assert.match(declined, /safer|alternative|move on|different/i);

  // A blank/unknown reason still returns a helpful nudge, not the word "Denied".
  assert.notEqual(denyNudge(undefined), 'Denied');
  assert.ok(denyNudge(undefined).length > 10);
});

test('requestBody carries the ids and parsed request', () => {
  assert.deepEqual(requestBody('b1', 'r1', { tool: 'Bash', input: { command: 'ls' } }), {
    buildSessionId: 'b1',
    requestId: 'r1',
    tool: 'Bash',
    input: { command: 'ls' },
  });
});
