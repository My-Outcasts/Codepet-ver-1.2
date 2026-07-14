'use client';
// Client helper for Byte's brainstorm step at "Let's build". Calls the server
// route (which holds the Anthropic key) with the running conversation and returns
// Byte's next move — another question, or a reflect-back "ready". Attaches the
// signed-in user's Firebase ID token. Mirrors lib/ai/buildPlan.ts.
import { getFirebaseAuth, isFirebaseConfigured } from '../firebase/client';
import type { BrainstormInput, BrainstormReply } from './brainstorm';

async function authHeader(): Promise<Record<string, string>> {
  if (!isFirebaseConfigured) return {};
  const user = getFirebaseAuth().currentUser;
  if (!user) return {};
  return { authorization: `Bearer ${await user.getIdToken()}` };
}

export class BrainstormError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = 'BrainstormError';
  }
}

export async function requestBuildBrainstorm(input: BrainstormInput): Promise<BrainstormReply> {
  const res = await fetch('/api/build-brainstorm', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new BrainstormError(data.error || `http_${res.status}`);
  }
  const { reply } = (await res.json()) as { reply: BrainstormReply };
  return reply;
}
