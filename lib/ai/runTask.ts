'use client';
// Client helper for the live task loop. Calls the server route (which holds the
// Anthropic key) and returns byte's generated deliverable — plain text for
// `text`, or a structured payload for post/email/legal. Attaches the signed-in
// user's Firebase ID token so the route can authenticate the caller.
import { getFirebaseAuth, isFirebaseConfigured } from '../firebase/client';
import type { CompanyBrief } from '../firebase/schema';
import type { TaskHelp } from './taskHelp';
import type { RunEvent } from './runTrace';
import { createEventDecoder } from './runStream';

export async function authHeader(): Promise<Record<string, string>> {
  if (!isFirebaseConfigured) return {};
  const user = getFirebaseAuth().currentUser;
  if (!user) return {};
  return { authorization: `Bearer ${await user.getIdToken()}` };
}

export type DeliverableKind =
  | 'text'
  | 'doc'
  | 'post'
  | 'email'
  | 'legal'
  | 'screens'
  | 'sheet'
  | 'site'
  | 'dms'
  | 'calendar'
  | 'checklist'
  | 'plan';

export interface RunArgs {
  kind: DeliverableKind;
  taskTitle: string;
  taskHint?: string;
  deptName?: string;
  deptKey?: string;
  /** Revise pass: byte's feedback + the current draft to revise. */
  reviseNote?: string;
  current?: string;
  /** The user's business brief, so byte writes from their real company. */
  brief?: CompanyBrief;
  /** The active companion's id, so the deliverable is written in its voice. */
  companionId?: string;
}

export interface RunResult {
  text?: string;
  payload?: unknown;
}

export class GenerateError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = 'GenerateError';
  }
}

export async function runByteTask(args: RunArgs): Promise<RunResult> {
  const res = await fetch('/api/run-task', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new GenerateError(data.error || `http_${res.status}`);
  }
  return (await res.json()) as RunResult;
}

/** Run a task and observe the real phases as they land. Same request as runByteTask —
 *  the route answers with NDJSON. `onEvent` fires per event so the run theater can
 *  render a phase the moment the server finishes it; the promise resolves with the
 *  deliverable in the identical shape runByteTask returns, so applyResult is unchanged.
 *
 *  A response that is NOT NDJSON (an older deployment, or a proxy that rewrote it) is
 *  read as one JSON body instead — the theater then shows the finished run without
 *  intermediate phases rather than failing. */
export async function runByteTaskStreaming(
  args: RunArgs,
  onEvent: (ev: RunEvent) => void,
): Promise<RunResult> {
  const res = await fetch('/api/run-task', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new GenerateError(data.error || `http_${res.status}`);
  }
  const streamed = (res.headers.get('content-type') || '').includes('x-ndjson');
  if (!streamed || !res.body) {
    const result = (await res.json()) as RunResult;
    onEvent({ type: 'result', ...result });
    return result;
  }

  const reader = res.body.getReader();
  const utf8 = new TextDecoder();
  const decode = createEventDecoder();
  let result: RunResult | null = null;
  let failure: string | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const ev of decode(utf8.decode(value, { stream: true }))) {
      onEvent(ev);
      if (ev.type === 'result') result = { text: ev.text, payload: ev.payload };
      if (ev.type === 'error') failure = ev.code;
    }
  }
  if (failure) throw new GenerateError(failure);
  if (!result) throw new GenerateError('generation_failed');
  return result;
}

export interface TaskHelpArgs {
  taskTitle: string;
  taskHint?: string;
  deptName?: string;
  deptKey?: string;
  brief?: CompanyBrief;
  companionId?: string;
}

/** Fetch a generated how-to + capture spec for a founder-owned ("needs your input") task.
 *  Throws GenerateError with the route's error code on failure, so the caller can detect
 *  AI-offline / rate-limit exactly like runByteTask and fall back to a static message. */
export async function fetchTaskHelp(args: TaskHelpArgs): Promise<TaskHelp> {
  const res = await fetch('/api/task-help', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new GenerateError(data.error || `http_${res.status}`);
  }
  return (await res.json()) as TaskHelp;
}

export interface EnrichAnswerResult {
  saved: boolean;
  gap: string;
  /** byte's distilled value that was persisted (present only when saved). */
  value?: string;
}

/** Send one first-run interview answer for byte to distill + persist into the brief.
 *  Fail-soft: a thrown/!ok response just means that field stays empty — the caller
 *  advances the interview regardless (never block onboarding on this). */
export async function postEnrichAnswer(
  gap: string,
  answer: string,
): Promise<EnrichAnswerResult | null> {
  try {
    const res = await fetch('/api/enrich-answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ gap, answer }),
    });
    if (!res.ok) return null;
    return (await res.json()) as EnrichAnswerResult;
  } catch {
    return null;
  }
}
