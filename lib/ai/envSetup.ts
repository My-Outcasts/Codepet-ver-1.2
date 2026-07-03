// Pure core for byte's chat-driven toolkit setup. No side effects — the client uses
// collectSetupItems to tell the server which items are off; the server uses
// parseSetupItems + matchSetupItem to ground and validate a suggestion; the store uses
// resolveEnvIndex to flip the approved item on. ENV is passed in so this stays testable.
import type { EnvItem } from '@/lib/data';

export type EnvCategory = 'skills' | 'connectors' | 'agents';
const CATEGORIES: EnvCategory[] = ['skills', 'connectors', 'agents'];

/** A toolkit item byte may suggest turning on (sent to the server for grounding). */
export interface SetupItem {
  category: EnvCategory;
  name: string;
  why: string;
}

/** Every currently-off toolkit item, in category order — the founder's "could enable" set. */
export function collectSetupItems(env: Record<string, EnvItem[]>): SetupItem[] {
  const out: SetupItem[] = [];
  for (const category of CATEGORIES) {
    for (const x of env[category] ?? []) {
      if (!x.s) out.push({ category, name: x.n, why: x.why || x.d });
    }
  }
  return out;
}

/** Defensively parse the client-sent off-items list (never trust the wire). */
export function parseSetupItems(raw: unknown): SetupItem[] {
  if (!Array.isArray(raw)) return [];
  const out: SetupItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (
      typeof o.category === 'string' &&
      (CATEGORIES as string[]).includes(o.category) &&
      typeof o.name === 'string'
    ) {
      out.push({
        category: o.category as EnvCategory,
        name: o.name,
        why: typeof o.why === 'string' ? o.why : '',
      });
    }
  }
  return out.slice(0, 40);
}

/** Validate a byte suggestion against the allowed (off) list; null if it isn't one. */
export function matchSetupItem(
  items: SetupItem[],
  category: unknown,
  name: unknown,
): SetupItem | null {
  if (typeof category !== 'string' || typeof name !== 'string') return null;
  const n = name.trim().toLowerCase();
  return (
    items.find((i) => i.category === category && i.name.trim().toLowerCase() === n) ?? null
  );
}

/** Index of a named item within its category, or -1. Used to flip it on. */
export function resolveEnvIndex(
  env: Record<string, EnvItem[]>,
  category: string,
  name: string,
): number {
  const list = env[category];
  if (!list) return -1;
  const n = name.trim().toLowerCase();
  return list.findIndex((x) => x.n.trim().toLowerCase() === n);
}
