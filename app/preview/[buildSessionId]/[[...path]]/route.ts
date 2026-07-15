// Serves a finished cloud build's static site out of Admin Storage. This is the
// `previewUrl` target written by `finalizeBuild` (lib/build/cloudStore.ts) — the
// route only ever needs `buildSessionId` because `buildStoragePrefix` namespaces
// storage by session id alone (no companyId in the public path).
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
  ctx: { params: Promise<{ buildSessionId: string; path?: string[] }> },
): Promise<Response> {
  const { buildSessionId, path } = await ctx.params;
  const rel = path && path.length ? path.join('/') : 'index.html';

  // BOTH url segments are user-controlled — guard the whole storage key, not just the
  // asset path. `buildSessionId` is always a crypto.randomUUID() when legit; running it
  // through the same traversal guard rejects a `..`/absolute segment before it can shape
  // the storage key (e.g. builds/preview/../secret).
  if (!safePath(buildSessionId) || !safePath(rel)) {
    return new Response('Bad request', { status: 400 });
  }

  const file = adminStorage().file(`${buildStoragePrefix(buildSessionId)}/${rel}`);
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
