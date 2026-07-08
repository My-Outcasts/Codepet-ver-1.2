// Pure: map a raw claude CLI error line to a founder-friendly hint (or null).
// The raw error still shows — the hint tells them what to actually do about it.

/** Not-installed / not-on-PATH spawn failures. */
const NOT_FOUND = /enoent|not found|command not found|no such file/i;
/** Signed-out / bad-credential failures from the CLI. */
const NOT_LOGGED_IN = /log ?in|logged out|api key|unauthoriz|authenticat|credential|401/i;

export function friendlyClaudeError(message: string): string | null {
  if (NOT_FOUND.test(message)) {
    return 'It looks like Claude Code isn’t installed on this machine yet — open “Wake byte up” from the top bar to set it up.';
  }
  if (NOT_LOGGED_IN.test(message)) {
    return 'It looks like Claude Code isn’t signed in on this machine. Open the Terminal app, type `claude`, and follow the login once — then start the build again.';
  }
  return null;
}
