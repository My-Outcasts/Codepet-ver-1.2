// Prompt construction for byte's deliverable generator (/api/run-task), split for
// PROMPT CACHING. The client caches the system block (see lib/ai/client.ts cachedSystem);
// so the layout here decides what actually gets cached.
//
// The split rule: put the STABLE, per-user prefix that repeats across every generation in
// the SYSTEM (company context — same for all of a founder's deliverables in a session), and
// keep the PER-TASK, volatile parts in the USER prompt (the specific task, its instruction,
// and prior-work ranked for THIS task's query). Prior work MUST stay out of the system —
// it changes every call, so caching it would bust the cache instead of filling it. This
// mirrors the chat route, which already grounds via a cached system block.
import { departmentBrief } from './departments';

// byte's voice + output contract. The grounding clause is shared across EVERY deliverable
// type (it lives here, not in the per-type instructions) so structural types like
// email/post/legal/screens get the same "use the real company, no generic filler"
// discipline as doc/plan — the fix for "too general, not detailed enough" output.
export const BYTE_SYSTEM = `You are byte, the AI building companion inside Codepet. You produce real, ready-to-use deliverables for a founder building their company with AI — not descriptions of deliverables.

Ground everything in the company context you're given: use the founder's real product, names, numbers, audience, locked-in decisions, and already-shipped work. Never invent facts — no made-up metrics, customers, integrations, or features that aren't in the context. When the context is thin, write tightly to what's actually there and make reasonable, clearly-general choices rather than padding with generic filler; specificity to THIS company is what makes the deliverable usable. Prefer depth over length.

Voice: warm, plain-language, confident, specific. No hype, no emoji, no clichés. Write the thing the founder will actually use.`;

// Baseline company context. Used only when the founder has no persisted brief yet; byte
// writes from the product until onboarding fills this in.
export const CODEPET_CONTEXT = `Codepet is a macOS companion that builds your whole company with you, department by department. It reads your project, writes the business brief and roadmap, then does real work across Engineering, Marketing, Design, Finance, Operations, Legal, Sales, and Support — producing real deliverables you approve. The promise is comprehension plus control: a real company, and one you actually understand.`;

/**
 * The cached system block: byte's contract + the founder's stable company context. Kept
 * identical across a session's generations so the whole prefix is a cache hit within the
 * TTL. Company context goes HERE (not the user turn) precisely so it caches.
 */
export function composeRunSystem(context: string): string {
  return `${BYTE_SYSTEM}\n\nThe founder's company: ${context}`;
}

export interface TaskFields {
  taskTitle: string;
  taskHint?: string;
  deptName?: string;
  deptKey?: string;
  reviseNote?: string;
  current?: string;
}

/**
 * The per-task USER prompt: the department focus, the task, its type instruction, the
 * prior-work grounding ranked for THIS task, and any revise pass. Deliberately excludes
 * the company context (that's in the cached system) so this — the volatile part — is the
 * only thing that changes call to call.
 */
export function buildTaskPrompt(opts: {
  instruction: string;
  priorWork: string;
  fields: TaskFields;
}): string {
  const { instruction, priorWork, fields } = opts;
  const { taskTitle, taskHint, deptName, deptKey, reviseNote, current } = fields;
  const lines: (string | null)[] = [
    ...(priorWork ? [priorWork, ''] : []),
    deptName ? `Department: ${deptName}` : null,
    deptKey && departmentBrief(deptKey) ? departmentBrief(deptKey) : null,
    `Task: ${taskTitle}`,
    taskHint ? `Intended deliverable: ${taskHint}` : null,
    '',
    instruction,
  ];

  if (reviseNote && current) {
    lines.push(
      '',
      'You previously produced this draft:',
      '---',
      current,
      '---',
      `Revise it to address this feedback: ${reviseNote}`,
      'Return the full revised deliverable (not a diff).',
    );
  } else {
    lines.push('', 'Produce the deliverable now.');
  }
  return lines.filter((l) => l !== null).join('\n');
}
