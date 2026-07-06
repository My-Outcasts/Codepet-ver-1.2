// Pure helpers for arming a live build session: compose the opening prompt Byte
// hands to `claude`, and build the shell command a Terminal window runs. No I/O
// so both are unit-tested; the osascript/fs spawn lives in the server action.
// See docs/superpowers/specs/2026-07-02-build-coach-live-session-design.md.
import type { BytePlan } from './ai/plan';

/** The first message the launched `claude` session receives, so it starts on-scope. */
export function buildOpeningPrompt(plan: BytePlan, brief: string): string {
  return [
    `Let's build: ${plan.title}`,
    `What to build: ${brief}`,
    '',
    'Plan:',
    ...plan.steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    'This is a non-interactive session: do NOT ask the user questions and do NOT use',
    'AskUserQuestion — Byte already agreed the plan above. Make reasonable assumptions,',
    'proceed on your own, and note any assumptions when you summarize at the end.',
    'Keep it small and token-thrifty; double-check before calling it done.',
  ].join('\n');
}

/** Escape a string for embedding inside a double-quoted shell argument. */
function shq(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** `cd "<dir>" && claude "<prompt>"` — the command a new Terminal window runs. */
export function terminalCommand(projectDir: string, prompt: string): string {
  return `cd "${shq(projectDir)}" && claude "${shq(prompt)}"`;
}
