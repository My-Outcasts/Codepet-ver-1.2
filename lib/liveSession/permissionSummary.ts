// Pure: a short, human-readable summary of what a permission-gated tool call will do,
// shown on the Allow/Deny card. Falls back to compact JSON for tools we don't special-
// case. Kept framework-free so it's unit-tested without React.

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** How much a tool call should worry a non-technical founder — drives the card's
 *  color + badge. safe = read-only / harmless, careful = changes files, risky =
 *  destructive or system-level shell. Conservative: unknown → careful. */
export type RiskLevel = 'safe' | 'careful' | 'risky';

const READONLY_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'AskUserQuestion',
  'WebFetch',
  'WebSearch',
]);
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
// Destructive / irreversible / system-level shell — anything here is "risky".
const RISKY_BASH =
  /(^|\s|&|\||;)(rm\s|rmdir\s|sudo\b|dd\s|mkfs|shutdown\b|reboot\b|kill\b|chmod\s+-?R?\s*777|chown\b|:\(\)\s*\{)|(-rf\b|--force\b|-f\b)|>\s*\/dev\/|\bgit\s+push\b|\bnpm\s+publish\b|\byarn\s+publish\b|\bcurl\b[^\n|]*\|\s*(sh|bash)|\bwget\b[^\n|]*\|\s*(sh|bash)/i;
// Clearly read-only shell — safe to run without worry.
const SAFE_BASH =
  /^\s*(ls|cat|echo|pwd|grep|rg|find|head|tail|wc|which|whoami|date|env|printenv|node\s+-v|npm\s+-v|git\s+(status|log|diff|branch|show)\b)/i;

/** Risk rating for a tool call (see RiskLevel). */
export function riskLevel(tool: string, input: unknown): RiskLevel {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  if (READONLY_TOOLS.has(tool)) return 'safe';
  if (EDIT_TOOLS.has(tool)) return 'careful';
  if (tool === 'Bash') {
    const cmd = str(o.command);
    if (RISKY_BASH.test(cmd)) return 'risky';
    if (SAFE_BASH.test(cmd)) return 'safe';
    return 'careful';
  }
  return 'careful';
}

// Plain-language face for each tool, so the live transcript reads like a story a
// non-coder can follow ("📖 Reading", "✏️ Editing") instead of tool names.
const TOOL_FACE: Record<string, { icon: string; verb: string }> = {
  Read: { icon: '📖', verb: 'Reading' },
  Glob: { icon: '🔎', verb: 'Looking through files' },
  Grep: { icon: '🔎', verb: 'Searching the code' },
  Write: { icon: '✏️', verb: 'Writing a file' },
  Edit: { icon: '✏️', verb: 'Editing' },
  MultiEdit: { icon: '✏️', verb: 'Editing' },
  NotebookEdit: { icon: '✏️', verb: 'Editing' },
  Bash: { icon: '▶️', verb: 'Running a command' },
  WebFetch: { icon: '🌐', verb: 'Fetching a page' },
  WebSearch: { icon: '🌐', verb: 'Searching the web' },
  TodoWrite: { icon: '🗒️', verb: 'Updating the plan' },
  Task: { icon: '🤖', verb: 'Working on a sub-task' },
};

/** An icon + plain verb for a tool call; falls back to a wrench + the raw name. */
export function friendlyTool(name: string): { icon: string; verb: string } {
  return TOOL_FACE[name] || { icon: '🔧', verb: name };
}

/** One-line description of a tool call for the permission card. */
export function describePermission(tool: string, input: unknown): string {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  switch (tool) {
    case 'Bash':
      return str(o.command) || 'run a shell command';
    case 'Write':
      return `Create or overwrite ${str(o.file_path) || 'a file'}`;
    case 'Edit':
    case 'MultiEdit':
      return `Edit ${str(o.file_path) || 'a file'}`;
    case 'Read':
      return `Read ${str(o.file_path) || 'a file'}`;
    case 'AskUserQuestion': {
      const qs = Array.isArray(o.questions) ? o.questions : [];
      const first = qs[0] && typeof qs[0] === 'object' ? (qs[0] as Record<string, unknown>) : null;
      return (first && str(first.question)) || 'ask you a question';
    }
    default: {
      const json = JSON.stringify(input ?? null);
      return json.length > 200 ? json.slice(0, 200) + '…' : json;
    }
  }
}
