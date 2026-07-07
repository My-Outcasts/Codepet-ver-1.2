import type { LogStep } from '../helpers';

export type UsedItem = { name: string; category: string };

type EnvLike = Record<string, { n: string; s: number; fits?: string[] }[]>;

// The on-items (s === 1) whose fit list includes this deliverable type. Single source of
// truth for both the execute-log mention and the receipt, so they never disagree.
export function toolkitUsedFor(env: EnvLike, type: string): UsedItem[] {
  const out: UsedItem[] = [];
  for (const [category, items] of Object.entries(env)) {
    for (const item of items) {
      if (item.s === 1 && item.fits?.includes(type)) out.push({ name: item.n, category });
    }
  }
  return out;
}

// Append a task title to an item's usage list — deduped (a re-run/revise of the same task
// never inflates the count) and capped at the 20 most recent.
export function appendTaskUse(tasks: string[] | undefined, title: string): string[] {
  const list = tasks ?? [];
  if (list.includes(title)) return list;
  return [...list, title].slice(-20);
}

// "Used in N tasks · last: '…'" — or null when the item has no usage yet.
export function usageReceipt(tasks: string[] | undefined): string | null {
  if (!tasks || tasks.length === 0) return null;
  const n = tasks.length;
  return `Used in ${n} task${n === 1 ? '' : 's'} · last: '${tasks[tasks.length - 1]}'`;
}

// One believable "byte used X" line per item, inserted before the base log's final step.
export function runLogWithToolkit(base: LogStep[], used: UsedItem[]): LogStep[] {
  if (!used.length || !base.length) return base;
  const verb = (u: UsedItem): string =>
    u.category === 'connectors'
      ? `Worked through your ${u.name} connection`
      : u.category === 'agents'
        ? `Ran the ${u.name} agent`
        : `Reviewed the work with the ${u.name} skill`;
  const steps: LogStep[] = used.map((u) => ({ t: verb(u) }));
  return [...base.slice(0, -1), ...steps, base[base.length - 1]];
}
