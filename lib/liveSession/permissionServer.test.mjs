import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toDecisionResult,
  parsePermissionInput,
  requestBody,
  denyResult,
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

test('toDecisionResult wraps a decision as an MCP text result', () => {
  const r = toDecisionResult({ decision: 'allow' });
  assert.equal(r.content[0].type, 'text');
  assert.deepEqual(JSON.parse(r.content[0].text), { decision: 'allow' });
});

test('denyResult is a deny decision result with a reason', () => {
  const r = denyResult('bridge down');
  assert.deepEqual(JSON.parse(r.content[0].text), { decision: 'deny', reason: 'bridge down' });
});

test('requestBody carries the ids and parsed request', () => {
  assert.deepEqual(requestBody('b1', 'r1', { tool: 'Bash', input: { command: 'ls' } }), {
    buildSessionId: 'b1',
    requestId: 'r1',
    tool: 'Bash',
    input: { command: 'ls' },
  });
});
