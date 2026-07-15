// Cloud demo build — the endpoint the E2B sandbox posts to when a build ends (success or
// error). Auth is the per-company ingest token, checked against the company doc — the exact
// same pattern as /api/track/live (see that route's comment for why this comparison always
// does the same amount of work whether or not the company/token exists). The payload is a
// semi-trusted sandbox report, so it's sanitized (lib/build/finalize.ts — rejects path
// traversal / oversize) before anything is stored. Storage + charging live in
// lib/build/cloudStore.ts's finalizeBuild: it saves the site's files, marks the liveBuild doc
// ended (with a previewUrl on success), and — only on success — increments today's usage doc
// so the build's credit cost is charged exactly once.
// See docs/superpowers/specs/2026-07-15-cloud-demo-build-design.md.
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { finalizeBuild } from '@/lib/build/cloudStore';
// Relative (not `@/`) for the modules this route does NOT mock in tests: vitest.config.ts
// has no tsconfig-paths plugin, so an unmocked `@/` value import fails to resolve under
// vitest (only mocked `@/` specifiers resolve, via vi.mock's interception) — see
// .superpowers/sdd/task-6-report.md's "Import-path note" for the same finding.
import { paths } from '../../../../lib/firebase/schema';
import { sanitizeFinalizeBody } from '../../../../lib/build/finalize';

export const runtime = 'nodejs';

interface CloudFinalizeBody {
  companyId?: string;
  token?: string;
  buildSessionId?: string;
  status?: string;
  tokens?: unknown;
  files?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const { companyId, token, buildSessionId, status: rawStatus, tokens, files } = (body ??
    {}) as CloudFinalizeBody;
  if (!companyId || !token || !buildSessionId) {
    return NextResponse.json(
      { error: 'missing companyId or token or buildSessionId' },
      { status: 400 },
    );
  }

  const db = adminDb();
  const companyRef = db.doc(paths.company(companyId));
  const snap = await companyRef.get();
  const ingestToken = snap.exists ? (snap.data()?.ingestToken as string | undefined) : undefined;
  // Constant work whether or not the company exists; a missing/blank token never matches.
  if (!ingestToken || token !== ingestToken) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const clean = sanitizeFinalizeBody({ tokens, files });
  if (!clean) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  const status = rawStatus === 'error' ? 'error' : 'ok';

  try {
    await finalizeBuild({
      companyId,
      buildSessionId,
      origin: new URL(req.url).origin,
      status,
      body: clean,
    });
  } catch (err) {
    console.error('[cloud-finalize] finalizeBuild failed', err);
    return NextResponse.json({ error: 'finalize_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
