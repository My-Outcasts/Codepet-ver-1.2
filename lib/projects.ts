// Pure helpers for the local-project list: validate the untrusted payload the
// scan CLI POSTs to /api/projects, and map stored projects to the picker's list
// of names. Framework-free so both are unit-tested without a network call.
// See docs/superpowers/specs/2026-07-02-local-project-scan-design.md.
import type { ScannedProject } from './firebase/schema';

export const MAX_PROJECTS = 300;
const MAX_NAME = 128;
const MAX_PATH = 512;

/** Coerce an untrusted request body into a bounded, deduped ScannedProject[].
 *  Entries missing a name or path are dropped; the list is capped and deduped
 *  by path (first occurrence wins). */
export function sanitizeProjects(raw: unknown): ScannedProject[] {
  if (!Array.isArray(raw)) return [];
  const out: ScannedProject[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === 'string' ? e.name.trim().slice(0, MAX_NAME) : '';
    const path = typeof e.path === 'string' ? e.path.trim().slice(0, MAX_PATH) : '';
    if (!name || !path || seen.has(path)) continue;
    seen.add(path);
    out.push({ name, path });
    if (out.length >= MAX_PROJECTS) break;
  }
  return out;
}

/** The distinct project names for the picker, in order, deduped by name. */
export function projectNames(projects: ScannedProject[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of projects) {
    if (seen.has(p.name)) continue;
    seen.add(p.name);
    out.push(p.name);
  }
  return out;
}
