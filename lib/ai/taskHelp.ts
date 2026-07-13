// Assisted founder tasks — the shared contract for a "needs your input" task's help.
//
// A founder-owned roadmap task (e.g. "Incorporate LLC", "Business bank account") gets a generated,
// grounded how-to plus an optional capture form for its non-sensitive OUTPUT. The captured values
// are written to the company `decisions` memory, which every downstream generation already reads —
// so completing one founder task quietly informs the next. Produced by /api/task-help, rendered in
// the chat, consumed by the store's capture handler.

export interface TaskGuide {
  /** One line on why this matters now. */
  call: string;
  /** The concrete steps to complete it. */
  steps: { h: string; p: string }[];
  /** A short shortlist of recommended options/providers, each with a one-line why. */
  options?: { name: string; why: string }[];
  /** Rough time estimate, e.g. "~15 min". */
  est?: string;
}

export interface CaptureField {
  /** Stable key used as the decision topic (e.g. "bank", "incorporation-state"). */
  key: string;
  label: string;
  placeholder?: string;
}

export interface TaskCapture {
  /** 1–3 NON-SENSITIVE fields recording the task's result. Never secrets (EIN, account #s). */
  fields: CaptureField[];
  /** A short "suggestions — verify before acting" style disclaimer. */
  note?: string;
}

export interface TaskHelp {
  guide: TaskGuide;
  capture?: TaskCapture;
}

/** JSON-schema the model is forced to emit (kept in sync with the types above). */
export const TASK_HELP_SCHEMA = {
  type: 'object',
  properties: {
    guide: {
      type: 'object',
      properties: {
        call: { type: 'string' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: { h: { type: 'string' }, p: { type: 'string' } },
            required: ['h', 'p'],
          },
        },
        options: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, why: { type: 'string' } },
            required: ['name', 'why'],
          },
        },
        est: { type: 'string' },
      },
      required: ['call', 'steps'],
    },
    capture: {
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              label: { type: 'string' },
              placeholder: { type: 'string' },
            },
            required: ['key', 'label'],
          },
        },
        note: { type: 'string' },
      },
      required: ['fields'],
    },
  },
  required: ['guide'],
} as const;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Defensively coerce a raw model object into a TaskHelp, or null if it's unusable. Caps list
 *  sizes so a runaway model can't flood the card, and drops any capture field without a key. */
export function coerceTaskHelp(raw: unknown): TaskHelp | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const g = (r.guide ?? {}) as Record<string, unknown>;
  const call = str(g.call);
  const steps = Array.isArray(g.steps)
    ? g.steps
        .map((s) => {
          const o = (s ?? {}) as Record<string, unknown>;
          return { h: str(o.h), p: str(o.p) };
        })
        .filter((s) => s.h || s.p)
        .slice(0, 6)
    : [];
  if (!call && steps.length === 0) return null; // nothing useful to show

  const options = Array.isArray(g.options)
    ? g.options
        .map((o) => {
          const x = (o ?? {}) as Record<string, unknown>;
          return { name: str(x.name), why: str(x.why) };
        })
        .filter((o) => o.name)
        .slice(0, 4)
    : undefined;

  const guide: TaskGuide = { call, steps, ...(options?.length ? { options } : {}), est: str(g.est) || undefined };

  let capture: TaskCapture | undefined;
  const c = r.capture as Record<string, unknown> | undefined;
  if (c && Array.isArray(c.fields)) {
    const fields = c.fields
      .map((f) => {
        const x = (f ?? {}) as Record<string, unknown>;
        return { key: str(x.key), label: str(x.label), placeholder: str(x.placeholder) || undefined };
      })
      .filter((f) => f.key && f.label)
      .slice(0, 3);
    if (fields.length) capture = { fields, note: str(c.note) || undefined };
  }

  return { guide, capture };
}
