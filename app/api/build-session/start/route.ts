// Start a live in-UI Claude Code session (local mode only). Spawns the real `claude`
// in the chosen project with the plan's opening prompt; the browser then opens
// /api/build-session/stream to watch it. Idempotent per buildSessionId: if the
// session is already live (registry hit) this just acks so the caller re-attaches
// to the stream's replay buffer. `resume: true` (a reloaded page reconnecting)
// NEVER spawns — a dead session answers `gone` instead of restarting the build.
// See the in-UI Claude session design spec.
import { NextResponse } from 'next/server';
import { startSession } from '@/lib/liveSession/engine';
import { getSession } from '@/lib/liveSession/registry';
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
  resume?: boolean;
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
  const { buildSessionId, projectDir, plan, brief, mode, resume } = body as StartBody;
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
  if (getSession(buildSessionId)) {
    return NextResponse.json({ ok: true, attached: true });
  }
  if (resume === true) {
    return NextResponse.json({ ok: false, reason: 'gone' }, { status: 410 });
  }
  const resolvedMode =
    mode && MODES.has(mode) ? (mode as 'suggest' | 'copilot' | 'autopilot') : 'suggest';
  startSession({
    buildSessionId,
    projectDir,
    // The in-UI session is two-way (the founder watches and can reply), so
    // questions are allowed — except on autopilot, where they asked not to be
    // interrupted (the terminal/copy-paste prompt stays non-interactive too).
    openingPrompt: buildOpeningPrompt(plan, brief, { twoWay: resolvedMode !== 'autopilot' }),
    mode: resolvedMode,
  });
  return NextResponse.json({ ok: true });
}
