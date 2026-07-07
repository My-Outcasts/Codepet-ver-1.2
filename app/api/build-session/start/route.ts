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
  mode?: string;
}

const MODES = new Set(['suggest', 'copilot', 'autopilot']);

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
  const { buildSessionId, projectDir, plan, brief, mode } = body as StartBody;
  if (
    !buildSessionId ||
    !projectDir ||
    !brief ||
    !plan ||
    typeof plan !== 'object' ||
    !Array.isArray((plan as { steps?: unknown }).steps)
  ) {
    return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  }
  startSession({
    buildSessionId,
    projectDir,
    openingPrompt: buildOpeningPrompt(plan, brief),
    mode: mode && MODES.has(mode) ? (mode as 'suggest' | 'copilot' | 'autopilot') : 'suggest',
  });
  return NextResponse.json({ ok: true });
}
