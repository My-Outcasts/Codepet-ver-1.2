'use client';
// Client helper for the Build Coach's "generate a plan" step. Calls the server
// route (which holds the Anthropic key) with the two think-first inputs and
// returns Byte's plan. Attaches the signed-in user's Firebase ID token so the
// route can authenticate the caller. Mirrors lib/ai/runTask.ts.
import { getFirebaseAuth, isFirebaseConfigured } from '../firebase/client';
import type { BytePlan, PlanInput } from './plan';

async function authHeader(): Promise<Record<string, string>> {
  if (!isFirebaseConfigured) return {};
  const user = getFirebaseAuth().currentUser;
  if (!user) return {};
  return { authorization: `Bearer ${await user.getIdToken()}` };
}

export class PlanError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = 'PlanError';
  }
}

export async function requestBuildPlan(input: PlanInput): Promise<BytePlan> {
  const res = await fetch('/api/build-plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new PlanError(data.error || `http_${res.status}`);
  }
  const { plan } = (await res.json()) as { plan: BytePlan };
  return plan;
}
