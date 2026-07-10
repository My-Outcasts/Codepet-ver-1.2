'use client';
// Demo mode — a dev/QA switch that stubs byte's AI calls with canned outputs, so the whole
// roadmap loop (run → deliverable → Approve → node flips Done → dependents unlock) and the chat
// can be walked WITHOUT a live model or credits. OFF by default; it never changes behavior
// unless explicitly turned on:
//   • append `?demo=1` to the URL (persists for the browser tab; `?demo=0` clears it), or
//   • set NEXT_PUBLIC_DEMO_AI=1 at build time.
// This is strictly for demos/testing — production leaves it off, so real byte output is unchanged.
import type { RunArgs, RunResult } from './runTask';
import type { ChatTurn } from './chatMessages';

const KEY = 'codepet-demo-ai';

/** Whether canned AI output should stand in for real model calls this session. */
export function isDemoMode(): boolean {
  if (process.env.NEXT_PUBLIC_DEMO_AI === '1') return true;
  if (typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search).get('demo');
    if (q === '1') sessionStorage.setItem(KEY, '1');
    else if (q === '0') sessionStorage.removeItem(KEY);
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** A short artificial delay so the "producing…" card is visible (feels like real work). */
export const demoDelay = (ms = 650): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A canned, on-brand deliverable for the given task — enough to render in the viewer and be
 *  approved. `doc` (the roadmap default) gets a structured payload; everything else falls back
 *  to plain text, which applyResult writes to `t.out` and every viewer can show. */
export function demoRunResult(args: RunArgs): RunResult {
  const title = args.taskTitle || 'this task';
  const co = args.brief?.projectName?.trim() || 'your company';
  if (args.kind === 'doc') {
    return {
      payload: {
        title,
        call: `A worked draft of “${title}” for ${co}. (Demo output — no AI credits used.)`,
        sections: [
          {
            h: 'What this is',
            p: `A sample of the deliverable byte would produce for “${title}”. In demo mode the content is canned so you can walk the whole run → approve → done flow.`,
          },
          { h: 'Key points', p: 'Point one. Point two. Point three.' },
          { h: 'Next', p: 'Approve this to mark the step done on your roadmap.' },
        ],
        next: ['Review the draft', 'Approve to complete the step'],
      },
    };
  }
  return {
    text: `**${title}** — demo deliverable for ${co}.\n\nCanned output so you can walk the run → approve → done flow without using AI credits. Approve it to complete this step on your roadmap.`,
  };
}

/** A short canned chat reply, so typing in chat "works" in demo mode. */
export function demoChatReply(history: ChatTurn[]): string {
  const last =
    [...history]
      .reverse()
      .find((h) => h.role === 'me')
      ?.text.trim() ?? '';
  const t = last.toLowerCase();
  if (!t) return `I'm byte. Demo mode is on — replies are canned and no AI credits are used.`;
  if (/next|do|task|step|what should/.test(t))
    return `Demo mode is on, so I can't plan live — but on your roadmap the glowing card is your next move. Click it and hit Start to see the run → approve → done flow (no credits used).`;
  return `Got it — “${last}”. This is a demo reply (no AI credits used). Try the roadmap: click a card to run or complete a step, then Approve it.`;
}
