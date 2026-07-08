// The founder's answer to a codepet_ask question, from the live view (an option
// chip or the composer). Resolves the parked question the MCP bridge is awaiting,
// so the real claude session continues with their answer. Local mode only.
import { NextResponse } from 'next/server';
import { resolveQuestion } from '@/lib/liveSession/engine';
import { detectCapability } from '@/lib/installer/capability.mjs';

export const runtime = 'nodejs';

interface Body {
  buildSessionId?: string;
  requestId?: string;
  answer?: string;
}

export async function POST(req: Request): Promise<Response> {
  if (detectCapability(process.env).mode !== 'local') {
    return NextResponse.json({ ok: false, reason: 'remote' }, { status: 409 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  }
  const { buildSessionId, requestId, answer } = body as Body;
  if (!buildSessionId || !requestId || typeof answer !== 'string' || !answer.trim()) {
    return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  }
  const ok = resolveQuestion(buildSessionId, requestId, answer.trim().slice(0, 2000));
  if (!ok) {
    return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
