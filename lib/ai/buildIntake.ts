'use client';
// Client helper for the intake brainstorm — calls the server route (which holds
// the Anthropic key) with the scan + turns and returns Byte's next line. Attaches
// the signed-in user's Firebase ID token. Mirrors lib/ai/buildPlan.ts; the store
// falls back to scripted copy on any thrown error.
import { getFirebaseAuth, isFirebaseConfigured } from '../firebase/client';
import type { IntakeInput, IntakeReply } from './intake';

async function authHeader(): Promise<Record<string, string>> {
  if (!isFirebaseConfigured) return {};
  const user = getFirebaseAuth().currentUser;
  if (!user) return {};
  return { authorization: `Bearer ${await user.getIdToken()}` };
}

export class IntakeError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = 'IntakeError';
  }
}

export async function requestIntakeReply(input: IntakeInput): Promise<IntakeReply> {
  const res = await fetch('/api/build-intake', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new IntakeError(data.error || `http_${res.status}`);
  }
  const { reply } = (await res.json()) as { reply: IntakeReply };
  return reply;
}
