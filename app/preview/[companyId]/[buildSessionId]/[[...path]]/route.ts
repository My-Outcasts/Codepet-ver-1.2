// Serves a finished cloud build's static site out of Admin Storage. This is the
// `previewUrl` target written by `finalizeBuild` (lib/build/cloudStore.ts) — the route
// is scoped by BOTH `companyId` and `buildSessionId` because `buildStoragePrefix`
// namespaces storage by companyId first: a company's build files can only ever live
// under its own companyId prefix, so a caller can't overwrite/read another company's
// preview by guessing/reusing its buildSessionId (see cloudStore.ts's finalizeBuild
// comment for the cross-tenant guard this backs up).
//
// Node runtime (not edge): uses the Admin SDK's Storage client.
import 'server-only';
import { adminStorage } from '@/lib/firebase/admin';
import { buildStoragePrefix } from '@/lib/build/cloudStore';
import { safePath } from '@/lib/build/finalize';
import { contentTypeFor } from '@/lib/build/contentType';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ companyId: string; buildSessionId: string; path?: string[] }> },
): Promise<Response> {
  const { companyId, buildSessionId, path } = await ctx.params;
  const rel = path && path.length ? path.join('/') : 'index.html';

  // ALL THREE url segments are user-controlled — guard the whole storage key, not just
  // the asset path. `companyId`/`buildSessionId` are always trusted-shape ids when
  // legit; running each through the same traversal guard rejects a `..`/absolute
  // segment before it can shape the storage key (e.g. builds/../secret/b9/index.html).
  if (!safePath(companyId) || !safePath(buildSessionId) || !safePath(rel)) {
    return new Response('Bad request', { status: 400 });
  }

  const file = adminStorage().file(`${buildStoragePrefix(companyId, buildSessionId)}/${rel}`);
  const [exists] = await file.exists();
  if (!exists) {
    return new Response('Not found', { status: 404 });
  }

  const [buf] = await file.download();
  return new Response(buf, {
    headers: {
      'content-type': contentTypeFor(rel),
      'cache-control': 'public, max-age=60',
    },
  });
}
