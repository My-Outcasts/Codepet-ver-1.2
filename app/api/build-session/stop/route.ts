// Stop a live in-UI Claude session (local mode only): kill the persistent child
// and drop its registry entry. Called by the client when the user leaves the
// DURING step, so the claude process doesn't outlive the UI. See the in-UI
// Claude session design spec (Phase 2).
import { NextResponse } from 'next/server';
import { stopSession } from '@/lib/liveSession/engine';
import { detectCapability } from '@/lib/installer/capability.mjs';

export const runtime = 'nodejs';

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
  const { buildSessionId } = body as { buildSessionId?: string };
  if (!buildSessionId) {
    return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  }
  stopSession(buildSessionId);
  return NextResponse.json({ ok: true });
}
