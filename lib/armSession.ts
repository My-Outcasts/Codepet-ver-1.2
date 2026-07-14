// Pure helpers for arming a live build session: compose the opening prompt Byte
// hands to `claude`, and build the shell command a Terminal window runs. No I/O
// so both are unit-tested; the osascript/fs spawn lives in the server action.
// See docs/superpowers/specs/2026-07-02-build-coach-live-session-design.md.
import type { BytePlan } from './ai/plan';

/** The first message the launched `claude` session receives, so it starts on-scope.
 *  `twoWay` = the in-UI live session, where the founder is watching and can reply —
 *  questions are allowed there. The terminal/copy-paste path stays non-interactive. */
export function buildOpeningPrompt(
  plan: BytePlan,
  brief: string,
  opts?: { twoWay?: boolean },
): string {
  const closing = opts?.twoWay
    ? [
        'The user is watching this session live and can reply. If a decision genuinely',
        'needs their input, ask briefly and wait; otherwise make reasonable assumptions',
        'and note them when you summarize at the end.',
        'Keep it small and token-thrifty; double-check before calling it done.',
      ]
    : [
        'This is a non-interactive session: do NOT ask the user questions and do NOT use',
        'AskUserQuestion — Byte already agreed the plan above. Make reasonable assumptions,',
        'proceed on your own, and note any assumptions when you summarize at the end.',
        'Keep it small and token-thrifty; double-check before calling it done.',
      ];
  return [
    `Let's build: ${plan.title}`,
    `What to build: ${brief}`,
    '',
    'Plan:',
    ...plan.steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    ...closing,
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

export const DEMO_DIR = '~/codepet-demo';
export const DEMO_PORT = 4321;
export const DEMO_URL = 'http://localhost:4321';

// A minimal but real starter landing page — byte builds this out during the demo.
export const DEMO_SEED_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Demo — built with Codepet</title>
  </head>
  <body>
    <!-- Starter page. byte will build this out. -->
    <main>
      <h1>Coming soon</h1>
      <p>This page is a throwaway demo target for Codepet's "Let's build".</p>
    </main>
  </body>
</html>
`;

// A single copy-paste command (remote mode): make the demo dir, seed index.html only if
// it's missing (so re-runs keep byte's progress), then run the real claude session.
// The seed is base64-embedded to avoid shell-escaping the HTML.
export function demoTerminalCommand(prompt: string): string {
  const b64 = btoa(unescape(encodeURIComponent(DEMO_SEED_HTML)));
  return (
    `mkdir -p ${DEMO_DIR} && cd ${DEMO_DIR} && ` +
    `{ [ -f index.html ] || echo '${b64}' | base64 -d > index.html; } && ` +
    `claude "${shq(prompt)}" ; ` +
    // Serve the built page (background) and open it, so the tester can view + re-view it.
    `python3 -m http.server ${DEMO_PORT} >/dev/null 2>&1 & sleep 1 && open ${DEMO_URL}`
  );
}
