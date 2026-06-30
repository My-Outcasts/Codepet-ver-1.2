'use client';
// Client helper for the live task loop. Calls the server route (which holds the
// Anthropic key) and returns byte's generated deliverable text.

export interface GenerateArgs {
  taskTitle: string;
  taskHint?: string;
  deptName?: string;
}

export class GenerateError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = 'GenerateError';
  }
}

export async function generateDeliverable(args: GenerateArgs): Promise<string> {
  const res = await fetch('/api/run-task', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new GenerateError(data.error || `http_${res.status}`);
  }
  const data = (await res.json()) as { text?: string };
  return (data.text ?? '').trim();
}
