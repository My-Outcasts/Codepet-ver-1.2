// GitHub-backed cloud build — the endpoint the E2B sandbox posts to when a repo build ends
// (success or error). Auth is the per-company ingest token, checked against the company doc —
// the exact same pattern as /api/build/cloud-finalize (see that route's comment for why this
// comparison always does the same amount of work whether or not the company/token exists).
// Recording the PR outcome and charging credits live in lib/build/repoFinalize.ts's
// finalizeRepoBuild: it atomically claims the build's live doc (missing → no_such_build,
// already ended → already_ended, else records the PR/branch) and — only on a successful push —
// increments today's usage doc so the build's credit cost is charged exactly once.
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { finalizeRepoBuild } from '@/lib/build/repoFinalize';
// Relative (not `@/`) for the modules this route does NOT mock in tests: vitest.config.ts
// has no tsconfig-paths plugin, so an unmocked `@/` value import fails to resolve under
// vitest (only mocked `@/` specifiers resolve, via vi.mock's interception) — see
// .superpowers/sdd/task-6-report.md's "Import-path note" for the same finding.
import { paths } from '../../../../lib/firebase/schema';

export const runtime = 'nodejs';

interface RepoFinalizeBody {
  companyId?: string;
  token?: string;
  buildSessionId?: string;
  status?: string;
  tokens?: unknown;
  prUrl?: unknown;
  branch?: unknown;
  pushed?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const {
    companyId,
    token,
    buildSessionId,
    status: rawStatus,
    tokens: rawTokens,
    prUrl: rawPrUrl,
    branch: rawBranch,
    pushed: rawPushed,
  } = (body ?? {}) as RepoFinalizeBody;

  if (
    typeof companyId !== 'string' ||
    !companyId ||
    typeof token !== 'string' ||
    !token ||
    typeof buildSessionId !== 'string' ||
    !buildSessionId
  ) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const db = adminDb();
  const companyRef = db.doc(paths.company(companyId));
  const snap = await companyRef.get();
  const ingestToken = snap.exists ? (snap.data()?.ingestToken as string | undefined) : undefined;
  // Constant work whether or not the company exists; a missing/blank token never matches.
  if (!ingestToken || token !== ingestToken) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Only an explicit 'ok' charges — a missing/blank/garbage status (or any value other
  // than the literal 'ok') is treated as a failed build and never charges (see #152).
  const status = rawStatus === 'ok' ? 'ok' : 'error';
  const pushed = rawPushed === true;
  const tokens = Number.isFinite(rawTokens) ? Math.max(0, Math.floor(rawTokens as number)) : 0;
  const prUrl = typeof rawPrUrl === 'string' ? rawPrUrl : undefined;
  const branch = typeof rawBranch === 'string' ? rawBranch : undefined;

  try {
    const result = await finalizeRepoBuild({
      companyId,
      buildSessionId,
      status,
      tokens,
      prUrl,
      branch,
      pushed,
    });
    if (!result.ok) {
      if (result.reason === 'no_such_build') {
        return NextResponse.json({ error: 'no_such_build' }, { status: 404 });
      }
      // 'already_ended' — a repeat finalize is idempotent success, not an error: nothing
      // was recorded/charged again, but the caller's original finalize already succeeded.
      return NextResponse.json({ ok: true });
    }
  } catch (err) {
    console.error('[repo-finalize] finalizeRepoBuild failed', err);
    return NextResponse.json({ error: 'finalize_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
