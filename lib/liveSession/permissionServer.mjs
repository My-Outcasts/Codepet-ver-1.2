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
  // The live CLI contract sends the tool's args under `input`
  // ({ tool_name, input, tool_use_id }); older code guessed `tool_input`, so keep
  // that as a fallback. Reading the wrong key left the Allow/Deny card showing
  // `null` and sent an empty updatedInput back on allow.
  const input = 'input' in raw ? raw.input : 'tool_input' in raw ? raw.tool_input : null;
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

/** Turn a raw decline reason into a keep-going instruction for claude, so a declined
 *  or timed-out step nudges the model toward a safer path or a graceful wrap-up
 *  instead of stalling the whole session (approval fatigue → don't dead-end). */
export function denyNudge(reason) {
  if (reason === 'timed out')
    return "The user didn't respond in time, so this step was auto-declined. Don't retry the same tool — continue with anything you can do without it, or stop and summarize what still needs their input.";
  if (reason === 'no such session')
    return 'This session is no longer active. Stop and end the turn.';
  return "The user declined this action. Don't repeat it — take a safer, different approach if one exists, or briefly explain why it's needed and move on. Don't abandon the whole task over this one step.";
}

/** The body POSTed to /api/build-session/permission/enqueue. */
export function requestBody(buildSessionId, requestId, parsed) {
  return { buildSessionId, requestId, tool: parsed.tool, input: parsed.input };
}

/** Coerce a codepet_ask tool-call input into { question, options } — options only
 *  when a non-empty array of short strings was given. */
export function parseAskInput(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const question =
    typeof o.question === 'string' && o.question.trim() ? o.question.trim().slice(0, 500) : '';
  const options = Array.isArray(o.options)
    ? o.options
        .filter((x) => typeof x === 'string' && x.trim())
        .map((x) => x.trim().slice(0, 120))
        .slice(0, 6)
    : [];
  return { question, options };
}

/** What claude reads when the founder didn't (or couldn't) answer — keep going
 *  rather than stalling the build on an unanswered question. */
export const NO_ANSWER_TEXT =
  "The user didn't answer. Proceed with your best judgment, note the assumption when you summarize, and don't ask this again.";

/** Wrap the founder's answer (or the no-answer fallback) as the MCP tool result. */
export function askResult(answer) {
  return {
    content: [
      { type: 'text', text: typeof answer === 'string' && answer ? answer : NO_ANSWER_TEXT },
    ],
  };
}

/** Forward a codepet_ask question to the app and wait for the founder's answer.
 *  Any failure → the no-answer fallback, so a broken bridge never stalls claude. */
async function askQuestion(requestId, parsed) {
  if (!parsed.question) return askResult(null);
  try {
    const res = await fetch(`${API_URL}/api/build-session/ask/enqueue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        buildSessionId: BUILD_SESSION_ID,
        requestId,
        question: parsed.question,
        options: parsed.options,
      }),
    });
    if (!res.ok) return askResult(null);
    const data = await res.json();
    return askResult(data?.answer ?? null);
  } catch {
    return askResult(null);
  }
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
      : denyResult(denyNudge(data?.reason));
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
            {
              name: 'codepet_ask',
              description:
                'Ask the user ONE short question when a decision genuinely needs their input. ' +
                'Give 2-4 short options when possible. Returns their answer as text.',
              inputSchema: {
                type: 'object',
                properties: {
                  question: { type: 'string', description: 'The question, one sentence.' },
                  options: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional 2-4 short answer choices.',
                  },
                },
                required: ['question'],
              },
            },
          ],
        },
      });
    } else if (msg.method === 'tools/call') {
      const requestId = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      if (msg.params?.name === 'codepet_ask') {
        const parsed = parseAskInput(msg.params?.arguments ?? msg.params?.input);
        const result = await askQuestion(requestId, parsed);
        send({ jsonrpc: '2.0', id: msg.id, result });
      } else {
        const parsed = parsePermissionInput(msg.params?.arguments ?? msg.params?.input);
        const result = await askApp(requestId, parsed);
        send({ jsonrpc: '2.0', id: msg.id, result });
      }
    }
  });
}

// Run the loop only as a script (not when imported for tests). import.meta.url ends
// with the invoked path when run directly.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
