// The user's Allow/Deny decision from the UI. Resolves the parked permission the
// MCP bridge is awaiting, so the real claude session proceeds or skips the tool.
// Local mode only. See the in-UI Claude session design spec (Phase 3).
import { NextResponse } from 'next/server';
import { resolvePermission } from '@/lib/liveSession/engine';
import { detectCapability } from '@/lib/installer/capability.mjs';

export const runtime = 'nodejs';

interface Body {
  buildSessionId?: string;
  requestId?: string;
  decision?: string;
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
  const { buildSessionId, requestId, decision } = body as Body;
  if (!buildSessionId || !requestId || (decision !== 'allow' && decision !== 'deny')) {
    return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  }
  const ok = resolvePermission(buildSessionId, requestId, { decision });
  if (!ok) {
    return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
