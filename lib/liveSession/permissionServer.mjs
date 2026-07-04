#!/usr/bin/env node
// MCP permission bridge for the in-UI Claude session. Claude Code (launched with
// --permission-prompt-tool codepet_permit --mcp-config <this>) calls the tool
// `codepet_permit` for each permission decision. This server forwards the request
// to the local Codepet app, which shows an Allow/Deny card and returns the user's
// choice. FAIL-SAFE: any error → deny, so a broken bridge never lets a tool run
// unattended and never crashes Claude. The CLI↔MCP contract here is best-known
// (see the Phase 3 plan's live-validation caveat).
//
// Pure mappers are exported for unit tests; the stdio loop runs only when invoked
// as a script.
import readline from 'node:readline';

const BUILD_SESSION_ID = process.env.CODEPET_BUILD_SESSION_ID || '';
const API_URL = (process.env.CODEPET_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

/** Coerce the CLI's permission tool-call input into our request shape. */
export function parsePermissionInput(raw) {
  if (!raw || typeof raw !== 'object') return { tool: 'unknown', input: null };
  const tool = typeof raw.tool_name === 'string' && raw.tool_name ? raw.tool_name : 'unknown';
  const input = 'tool_input' in raw ? raw.tool_input : null;
  return { tool, input: tool === 'unknown' ? null : input };
}

/** Wrap a Claude permission-result object as the MCP tool result (text = JSON). */
export function toDecisionResult(result) {
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}

/** Allow result — Claude expects { behavior:'allow', updatedInput }. */
export function allowResult(updatedInput) {
  return toDecisionResult({ behavior: 'allow', updatedInput: updatedInput ?? {} });
}

/** Deny result (also the fail-safe) — Claude expects { behavior:'deny', message }. */
export function denyResult(message) {
  return toDecisionResult({ behavior: 'deny', message: message || 'Denied' });
}

/** The body POSTed to /api/build-session/permission/enqueue. */
export function requestBody(buildSessionId, requestId, parsed) {
  return { buildSessionId, requestId, tool: parsed.tool, input: parsed.input };
}

/** Ask the app for a decision. Returns a decision result; deny on any failure. */
async function askApp(requestId, parsed) {
  try {
    const res = await fetch(`${API_URL}/api/build-session/permission/enqueue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody(BUILD_SESSION_ID, requestId, parsed)),
    });
    if (!res.ok) return denyResult(`bridge returned ${res.status}`);
    const data = await res.json();
    return data && data.decision === 'allow'
      ? allowResult(parsed.input)
      : denyResult(data?.reason || 'Denied by user');
  } catch (e) {
    return denyResult(e instanceof Error ? e.message : 'bridge unreachable');
  }
}

// Minimal MCP stdio loop: respond to initialize / tools/list / tools/call. Only the
// codepet_permit tool is exposed. Kept intentionally small; the pure mappers above
// carry the logic under test.
function main() {
  const rl = readline.createInterface({ input: process.stdin });
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
  rl.on('line', async (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'codepet-permit', version: '1.0.0' },
        },
      });
    } else if (msg.method === 'tools/list') {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          tools: [
            {
              name: 'codepet_permit',
              description: 'Ask the Codepet user to allow or deny a tool call.',
              inputSchema: { type: 'object' },
            },
          ],
        },
      });
    } else if (msg.method === 'tools/call') {
      const requestId = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      const parsed = parsePermissionInput(msg.params?.arguments ?? msg.params?.input);
      const result = await askApp(requestId, parsed);
      send({ jsonrpc: '2.0', id: msg.id, result });
    }
  });
}

// Run the loop only as a script (not when imported for tests). import.meta.url ends
// with the invoked path when run directly.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
