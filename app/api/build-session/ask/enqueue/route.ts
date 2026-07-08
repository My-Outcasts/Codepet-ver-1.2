// Called by the local MCP bridge (permissionServer.mjs) when claude asks the
// founder a question via codepet_ask. Parks the question (surfacing option chips
// in the live view) and holds this response open until the user answers or it
// times out ({ answer: null } → claude proceeds on its own judgment). Local only.
import { NextResponse } from 'next/server';
import { enqueueQuestion } from '@/lib/liveSession/engine';
import { detectCapability } from '@/lib/installer/capability.mjs';

export const runtime = 'nodejs';

interface Body {
  buildSessionId?: string;
  requestId?: string;
  question?: string;
  options?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  if (detectCapability(process.env).mode !== 'local') {
    return NextResponse.json({ answer: null, reason: 'remote' }, { status: 409 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ answer: null, reason: 'bad_request' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ answer: null, reason: 'bad_request' }, { status: 400 });
  }
  const { buildSessionId, requestId, question, options } = body as Body;
  if (!buildSessionId || !requestId || !question || typeof question !== 'string') {
    return NextResponse.json({ answer: null, reason: 'bad_request' }, { status: 400 });
  }
  const opts = Array.isArray(options)
    ? options
        .filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
        .map((o) => o.trim().slice(0, 120))
        .slice(0, 6)
    : undefined;
  const result = await enqueueQuestion(buildSessionId, {
    requestId,
    question: question.trim().slice(0, 500),
    options: opts,
  });
  return NextResponse.json(result);
}
