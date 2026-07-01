'use client';
// Client helper for the live task loop. Calls the server route (which holds the
// Anthropic key) and returns byte's generated deliverable — plain text for
// `text`, or a structured payload for post/email/legal. Attaches the signed-in
// user's Firebase ID token so the route can authenticate the caller.
import { getFirebaseAuth, isFirebaseConfigured } from '../firebase/client';
import type { CompanyBrief } from '../firebase/schema';

export async function authHeader(): Promise<Record<string, string>> {
  if (!isFirebaseConfigured) return {};
  const user = getFirebaseAuth().currentUser;
  if (!user) return {};
  return { authorization: `Bearer ${await user.getIdToken()}` };
}

export type DeliverableKind = 'text' | 'post' | 'email' | 'legal' | 'screens' | 'sheet' | 'site';

export interface RunArgs {
  kind: DeliverableKind;
  taskTitle: string;
  taskHint?: string;
  deptName?: string;
  /** Revise pass: byte's feedback + the current draft to revise. */
  reviseNote?: string;
  current?: string;
  /** The user's business brief, so byte writes from their real company. */
  brief?: CompanyBrief;
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
