// Send a follow-up user turn into a live in-UI Claude session (local mode only).
// Writes the turn to the persistent child's stdin via the engine. See the in-UI
// Claude session design spec (Phase 2).
import { NextResponse } from 'next/server';
import { sendTurn } from '@/lib/liveSession/engine';
import { detectCapability } from '@/lib/installer/capability.mjs';

export const runtime = 'nodejs';

interface SendBody {
  buildSessionId?: string;
  text?: string;
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
  const { buildSessionId, text } = body as SendBody;
  if (!buildSessionId || !text || typeof text !== 'string' || !text.trim()) {
    return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  }
  const sent = sendTurn(buildSessionId, text.trim());
  if (!sent) {
    return NextResponse.json({ ok: false, reason: 'not_running' }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
