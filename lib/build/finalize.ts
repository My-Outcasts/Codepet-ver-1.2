// Pure validation of the /api/build/cloud-finalize payload the sandbox posts. The
// sandbox is only semi-trusted, so paths are the critical guard: reject anything that
// could escape the build's storage prefix. No I/O — unit-tested.

const MAX_FILES = 50;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const MAX_TOKENS = 2_000_000_000;

export interface FinalizeFile {
  path: string;
  base64: string;
}
export interface FinalizeBody {
  tokens: number;
  files: FinalizeFile[];
}

/** A safe, relative, traversal-free web path (POSIX). Exported so the /preview
 *  route can reuse the same guard on the (user-controlled, URL-derived) asset path. */
export function safePath(p: unknown): p is string {
  if (typeof p !== 'string' || p.length === 0 || p.length > 400) return false;
  if (p.includes('\0')) return false;
  if (p.includes('\\')) return false;
  if (p.startsWith('/')) return false;
  const parts = p.split('/');
  return parts.every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

export function sanitizeFinalizeBody(raw: unknown): FinalizeBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (!Array.isArray(b.files) || b.files.length === 0 || b.files.length > MAX_FILES) return null;

  const files: FinalizeFile[] = [];
  let total = 0;
  for (const f of b.files) {
    if (!f || typeof f !== 'object') return null;
    const rec = f as Record<string, unknown>;
    if (!safePath(rec.path) || typeof rec.base64 !== 'string') return null;
    // Decoded byte length of base64 (no padding rounding needed for a cap check).
    total += Math.floor((rec.base64.length * 3) / 4);
    if (total > MAX_TOTAL_BYTES) return null;
    files.push({ path: rec.path, base64: rec.base64 });
  }

  const rawTokens = typeof b.tokens === 'number' && Number.isFinite(b.tokens) ? b.tokens : 0;
  const tokens = Math.min(MAX_TOKENS, Math.max(0, Math.floor(rawTokens)));
  return { tokens, files };
}
