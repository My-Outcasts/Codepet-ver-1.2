// byte's app-navigation guide. When the founder asks where a part of Codepet is — or
// to see/open/go to a function — byte calls the `navigate` tool with a destination; this
// turns that (validated) destination into the one-tap chip the chat renders ("Take me to
// the Roadmap"). Pure and dependency-free so both the server (tool validation) and the
// client (chip label + department resolution) share one source of truth, and it's unit-
// tested in plain node. The single-source list also feeds the tool's enum.

export type NavDest = 'roadmap' | 'tasks' | 'library' | 'company' | 'environment' | 'department';

/** All destinations byte may navigate to. Also used as the `navigate` tool's enum. */
export const NAV_DESTINATIONS: readonly NavDest[] = [
  'roadmap',
  'tasks',
  'library',
  'company',
  'environment',
  'department',
];

/** A resolved navigation chip: what the button says and where tapping it goes. */
export interface NavChip {
  label: string;
  dest: NavDest;
  /** For `department`, the resolved department key. Absent for the top-level views. */
  target?: string;
}

// Chip label per top-level destination. `department` is labelled from the resolved name.
const NAV_LABEL: Record<Exclude<NavDest, 'department'>, string> = {
  roadmap: 'Take me to the Roadmap',
  tasks: 'Take me to Tasks',
  library: 'Open the Library',
  company: 'Show my company',
  environment: 'Open Environment',
};

/**
 * Turn a (possibly untrusted) destination + target into a chip, or undefined if it isn't
 * a real destination. For `department` the target must resolve to a known department (by
 * key or name, case-insensitively) — otherwise there's nowhere to go, so no chip. This is
 * the guard that keeps a hallucinated destination from ever producing a live button.
 */
export function resolveNavChip(
  dest: string,
  target: string | undefined,
  depts: readonly { k: string; name: string }[],
): NavChip | undefined {
  if (dest === 'department') {
    const t = target?.trim().toLowerCase();
    if (!t) return undefined;
    const dep = depts.find((d) => d.k.toLowerCase() === t || d.name.toLowerCase() === t);
    if (!dep) return undefined;
    return { label: `Open ${dep.name}`, dest: 'department', target: dep.k };
  }
  if (dest in NAV_LABEL) {
    const d = dest as Exclude<NavDest, 'department'>;
    return { label: NAV_LABEL[d], dest: d };
  }
  return undefined;
}
