// Start a live in-UI Claude Code session (local mode only). Spawns the real `claude`
// in the chosen project with the plan's opening prompt; the browser then opens
// /api/build-session/stream to watch it. See the in-UI Claude session design spec.
import { NextResponse } from 'next/server';
import { startSession } from '@/lib/liveSession/engine';
import { buildOpeningPrompt } from '@/lib/armSession';
import { detectCapability } from '@/lib/installer/capability.mjs';
import type { BytePlan } from '@/lib/ai/plan';

export const runtime = 'nodejs';

interface StartBody {
  buildSessionId?: string;
  projectDir?: string;
  plan?: BytePlan;
  brief?: string;
}

export async function POST(req: Request): Promise<Response> {
  if (detectCapability(process.env).mode !== 'local') {
    return NextResponse.json({ ok: false, reason: 'remote' }, { status: 409 });
  }
  let body: StartBody;
  try {
    body = (await req.json()) as StartBody;
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  }
  const { buildSessionId, projectDir, plan, brief } = body;
  if (!buildSessionId || !projectDir || !plan || typeof plan !== 'object' || !brief) {
    return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  }
  startSession({
    buildSessionId,
    projectDir,
    openingPrompt: buildOpeningPrompt(plan, brief),
  });
  return NextResponse.json({ ok: true });
}
