import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toDecisionResult,
  allowResult,
  denyResult,
  parsePermissionInput,
  requestBody,
} from './permissionServer.mjs';

test('parsePermissionInput coerces the CLI tool-call shape', () => {
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

test('requestBody carries the ids and parsed request', () => {
  assert.deepEqual(requestBody('b1', 'r1', { tool: 'Bash', input: { command: 'ls' } }), {
    buildSessionId: 'b1',
    requestId: 'r1',
    tool: 'Bash',
    input: { command: 'ls' },
  });
});
