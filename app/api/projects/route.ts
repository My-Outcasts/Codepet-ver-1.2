// Ingest endpoint for the local project scan. The scan CLI (scripts/scan-projects.mjs)
// POSTs the list of git repos it found here. Auth is the same per-company ingest
// token the tracker uses (no Firebase user session on the machine). Writes go
// through the Admin SDK. Only project names + paths are stored — never file
// contents. Mirrors app/api/track.
// See docs/superpowers/specs/2026-07-02-local-project-scan-design.md.
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { paths } from '@/lib/firebase/schema';
import { sanitizeProjects } from '@/lib/projects';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const { companyId, token, projects } = (body ?? {}) as {
    companyId?: string;
    token?: string;
    projects?: unknown;
  };
  if (!companyId || !token) {
    return NextResponse.json({ error: 'missing companyId or token' }, { status: 400 });
  }

  const db = adminDb();
  const companyRef = db.doc(paths.company(companyId));
  const snap = await companyRef.get();
  const ingestToken = snap.exists ? (snap.data()?.ingestToken as string | undefined) : undefined;
  // Constant work whether or not the company exists; a missing/blank token never matches.
  if (!ingestToken || token !== ingestToken) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const clean = sanitizeProjects(projects);
  const ts = Date.now();
  await companyRef.update({ projects: clean, projectsScannedAt: ts, updatedAt: ts });
  return NextResponse.json({ ok: true, count: clean.length });
}
