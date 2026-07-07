// Called by the local MCP permission bridge (permissionServer.mjs) when claude asks
// to run a tool. Parks the request (surfacing an Allow/Deny card in the UI) and holds
// this response open until the user decides or it times out, then returns the
// decision to the bridge. Local mode only.
import { NextResponse } from 'next/server';
import { enqueuePermission } from '@/lib/liveSession/engine';
import { detectCapability } from '@/lib/installer/capability.mjs';

export const runtime = 'nodejs';

interface Body {
  buildSessionId?: string;
  requestId?: string;
  tool?: string;
  input?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  if (detectCapability(process.env).mode !== 'local') {
    return NextResponse.json({ decision: 'deny', reason: 'remote' }, { status: 409 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ decision: 'deny', reason: 'bad_request' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ decision: 'deny', reason: 'bad_request' }, { status: 400 });
  }
  const { buildSessionId, requestId, tool, input } = body as Body;
  if (!buildSessionId || !requestId || !tool) {
    return NextResponse.json({ decision: 'deny', reason: 'bad_request' }, { status: 400 });
  }
  const decision = await enqueuePermission(buildSessionId, { requestId, tool, input });
  return NextResponse.json(decision);
}
