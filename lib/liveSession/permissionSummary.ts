// Pure: a short, human-readable summary of what a permission-gated tool call will do,
// shown on the Allow/Deny card. Falls back to compact JSON for tools we don't special-
// case. Kept framework-free so it's unit-tested without React.

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
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
