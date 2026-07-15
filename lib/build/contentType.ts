// Pure extension -> content-type mapping for the /preview/[buildSessionId] route.
// No I/O — unit-tested directly.

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const DEFAULT_TYPE = 'application/octet-stream';

/** Infer a response content-type from a file path's extension. Falls back to
 *  application/octet-stream for unknown or missing extensions. */
export function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return DEFAULT_TYPE;
  const ext = path.slice(dot).toLowerCase();
  return TYPES[ext] ?? DEFAULT_TYPE;
}
