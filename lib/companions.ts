// The companion roster — the single source of truth for who can accompany a
// founder. Identity + voice only: each entry differs by name, sprite, and tone;
// the engine, tools, and capabilities are identical across all of them.
// byte MUST be first (the default fallback).
export interface Companion {
  id: string;
  name: string;
  /** Public path to the sprite (byte keeps its original PNG; others are SVGs). */
  sprite: string;
  /** One-line persona, appended to the system prompt so this companion speaks
   *  in its own voice. Empty-effect for byte (byte is the baseline voice). */
  tone: string;
  /** Signature accent (light-mode base hex). Selecting this companion re-tints the app's
   *  --accent and its derivatives (see lib/theme accentVars) so the beacon, active nav,
   *  primary buttons and focus rings take on this colour, in both light and dark. byte's is
   *  the brand violet — the CSS default. */
  accent: string;
}

export const DEFAULT_COMPANION_ID = 'byte';

export const COMPANIONS: Companion[] = [
  {
    id: 'byte',
    name: 'Codepet',
    sprite: '/byte.png',
    tone: 'the reliable companion — warm, clear, and encouraging.',
    accent: '#7c3aed', // brand violet (the CSS default)
  },
  {
    id: 'nova',
    name: 'Nova',
    sprite: '/companions/nova.svg',
    tone: 'upbeat and energetic — an optimist who brings launch energy.',
    accent: '#eab308', // launch gold
  },
  {
    id: 'crash',
    name: 'Crash',
    sprite: '/companions/crash.svg',
    tone: 'blunt, fast, and ship-it — a no-nonsense builder.',
    accent: '#ea580c', // ship-it clay
  },
  {
    id: 'sage',
    name: 'Sage',
    sprite: '/companions/sage.svg',
    tone: 'calm, wise, and reflective — a patient strategist.',
    accent: '#14b8a6', // calm teal
  },
  {
    id: 'glitch',
    name: 'Glitch',
    sprite: '/companions/glitch.svg',
    tone: 'playful, quirky, and experimental — a curious tinkerer.',
    accent: '#ec4899', // playful rose
  },
  {
    id: 'luna',
    name: 'Luna',
    sprite: '/companions/luna.svg',
    tone: 'gentle, steady, and reassuring — a calm presence for the long haul.',
    accent: '#3b82f6', // moon blue
  },
  {
    id: 'null',
    name: 'Null',
    sprite: '/companions/null.svg',
    tone: 'sharp, dry, and precise — a rigorous analyst.',
    accent: '#64748b', // precise slate
  },
];

export function companionById(id: string | null | undefined): Companion {
  return COMPANIONS.find((c) => c.id === id) ?? COMPANIONS[0];
}

/**
 * The fixed pet ↔ department mapping — the single source of truth for which
 * companion voices a given department's work. Each department has one pet; the
 * founder does not pick. There are 8 departments and 7 pets, so Null covers the
 * two least-important departments (Finance + Legal). Any unknown/empty key (e.g.
 * a general, non-department surface) falls back to byte, the default.
 */
const DEPT_COMPANION: Record<string, string> = {
  eng: 'byte',
  sales: 'crash',
  mkt: 'nova',
  design: 'glitch',
  ops: 'sage',
  support: 'luna',
  fin: 'null',
  legal: 'null',
};

/** Resolve the companion that voices a department's work (byte for unknown keys). */
export function companionForDept(deptKey: string | null | undefined): Companion {
  const id = deptKey ? DEPT_COMPANION[deptKey] : undefined;
  return companionById(id ?? DEFAULT_COMPANION_ID);
}

/**
 * The persona line appended to a system prompt so the active companion speaks in
 * its own voice. Empty for byte (byte is the baseline). Written as an override so
 * it wins over the "You are byte…" opening of the existing prompts.
 */
export function personaOverride(id: string | null | undefined): string {
  const c = companionById(id);
  if (c.id === DEFAULT_COMPANION_ID) return '';
  return `\n\nYOU ARE APPEARING AS ${c.name} — ${c.tone} Speak in the first person as ${c.name}, never as "byte". Keep the same substance, judgment, and helpfulness; only the name and tone are yours.`;
}
