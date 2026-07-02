// Shared task-execution glue: which deliverable types byte can produce live, how a
// task's kind maps to the run-task API `kind`, the current draft for a revise pass,
// and how byte's result is merged back onto the task. Extracted from ArtifactModal so
// the SAME pipeline runs whether a task is executed from its department panel OR from
// byte's chat (the "run it from here" path). Keep this presentation-agnostic.
import type { Task } from '@/lib/data';
import type { RunResult, DeliverableKind } from './runTask';
import { buildSheetInputs } from './sheetModel';
import { renderSiteHtml } from './siteTemplate';
import { deriveOut } from './deriveOut';

// Deliverable types byte generates live via the Claude API. Plain-text
// (doc/prep/build) come back as text; post/email/legal/screens/sheet/site/dms/
// calendar/checklist/plan come back as structured payloads. `plan` is an honest
// code-change plan (goal/approach/changes) byte hands off — not a fake merged PR.
export const LIVE_TYPES = new Set([
  'doc',
  'prep',
  'build',
  'post',
  'email',
  'legal',
  'screens',
  'sheet',
  'site',
  'dms',
  'calendar',
  'checklist',
  'plan',
]);

export function liveKind(type: string): DeliverableKind | null {
  // build is a plain-text outcome (renders t.out), same as doc/prep.
  if (type === 'doc' || type === 'prep' || type === 'build') return 'text';
  if (
    type === 'post' ||
    type === 'email' ||
    type === 'legal' ||
    type === 'screens' ||
    type === 'sheet' ||
    type === 'site' ||
    type === 'dms' ||
    type === 'calendar' ||
    type === 'checklist' ||
    type === 'plan'
  )
    return type;
  return null;
}

// The current draft byte revises against (structured payloads serialized to JSON).
export function currentDraft(t: Task, type: string): string {
  if (type === 'post') return JSON.stringify(t.post ?? {});
  if (type === 'email') return JSON.stringify(t.email ?? {});
  if (type === 'legal') return JSON.stringify(t.legal ?? {});
  if (type === 'screens') return JSON.stringify(t.screens ?? []);
  if (type === 'sheet') return JSON.stringify(t.sheet ?? {});
  if (type === 'dms') return JSON.stringify(t.dms ?? []);
  if (type === 'calendar') return JSON.stringify(t.calendar ?? {});
  if (type === 'checklist') return JSON.stringify(t.checklist ?? []);
  if (type === 'plan') return JSON.stringify(t.plan ?? {});
  // Site revises against the structured spec (small), not the rendered HTML.
  if (type === 'site') return JSON.stringify(t.siteSpec ?? {});
  return typeof t.out === 'string' ? t.out : '';
}

// Apply byte's result onto the task, merging structured payloads with the
// presentational defaults the viewers expect (author/stats/from/updated).
export function applyResult(t: Task, type: string, res: RunResult): void {
  if (type === 'post' && res.payload) {
    const p = res.payload as { variants?: Array<{ label: string; body: string }> };
    if (p.variants?.length) {
      t.post = {
        author: t.post?.author ?? 'byte',
        handle: t.post?.handle ?? '@codepet',
        stats: t.post?.stats ?? { replies: 18, reposts: 34, likes: 210 },
        variants: p.variants,
      };
      const out = deriveOut('post', res.payload);
      if (out) t.out = out;
    }
  } else if (type === 'email' && res.payload) {
    // Only apply when the arrays the viewer maps over (body, seq) are present —
    // otherwise keep the seed rather than hand EmailViewer an undefined .map().
    const e = res.payload as Record<string, unknown>;
    if (Array.isArray(e.body) && Array.isArray(e.seq)) {
      t.email = {
        from: t.email?.from ?? 'byte',
        fromAddr: t.email?.fromAddr ?? 'hello@code-pet.com',
        subject: e.subject,
        preheader: e.preheader,
        body: e.body,
        cta: e.cta,
        seq: e.seq,
      };
      const out = deriveOut('email', res.payload);
      if (out) t.out = out;
    }
  } else if (type === 'legal' && res.payload) {
    // Same guard: sections is what LegalViewer maps over.
    const l = res.payload as Record<string, unknown>;
    if (Array.isArray(l.sections)) {
      t.legal = {
        docTitle: l.docTitle,
        updated: t.legal?.updated ?? 'Draft · for your review',
        sections: l.sections,
        flag: l.flag,
      };
      const out = deriveOut('legal', res.payload);
      if (out) t.out = out;
    }
  } else if (type === 'screens' && res.payload) {
    const s = res.payload as { screens?: unknown[] };
    if (Array.isArray(s.screens) && s.screens.length) {
      t.screens = s.screens;
      const out = deriveOut('screens', res.payload);
      if (out) t.out = out;
    }
  } else if (type === 'dms' && res.payload) {
    // Keep only entries with the fields DmsViewer maps over (name drives the avatar
    // initial via name[0], msg is the copyable body) — a partial payload keeps the seed.
    const d = res.payload as { messages?: unknown[] };
    const msgs = Array.isArray(d.messages)
      ? d.messages.filter(
          (m): m is { name: string; note: string; msg: string } =>
            !!m &&
            typeof m === 'object' &&
            typeof (m as { name?: unknown }).name === 'string' &&
            (m as { name: string }).name.trim().length > 0 &&
            typeof (m as { msg?: unknown }).msg === 'string' &&
            (m as { msg: string }).msg.trim().length > 0,
        )
      : [];
    if (msgs.length) {
      t.dms = msgs.map((m) => ({
        name: m.name,
        note: typeof m.note === 'string' ? m.note : '',
        msg: m.msg,
      }));
      const out = deriveOut('dms', res.payload);
      if (out) t.out = out;
    }
  } else if (type === 'calendar' && res.payload) {
    // CalendarViewer maps weeks[].items[] — keep only weeks that carry a real items
    // array, and only items with a body; a partial payload keeps the seed.
    const c = res.payload as { weeks?: unknown[] };
    const weeks = Array.isArray(c.weeks)
      ? c.weeks
          .map((w) => {
            if (!w || typeof w !== 'object') return null;
            const row = w as { label?: unknown; items?: unknown };
            const items = Array.isArray(row.items)
              ? row.items.filter(
                  (it): it is { day: string; kind: string; body: string } =>
                    !!it &&
                    typeof it === 'object' &&
                    typeof (it as { body?: unknown }).body === 'string' &&
                    (it as { body: string }).body.trim().length > 0,
                )
              : [];
            if (!items.length) return null;
            return {
              label: typeof row.label === 'string' ? row.label : '',
              items: items.map((it) => ({
                day: typeof it.day === 'string' ? it.day : '',
                kind: typeof it.kind === 'string' ? it.kind : '',
                body: it.body,
              })),
            };
          })
          .filter(
            (
              w,
            ): w is { label: string; items: Array<{ day: string; kind: string; body: string }> } =>
              w !== null,
          )
      : [];
    if (weeks.length) {
      t.calendar = { weeks };
      const out = deriveOut('calendar', res.payload);
      if (out) t.out = out;
    }
  } else if (type === 'checklist' && res.payload) {
    // ChecklistViewer maps items reading {t, done} and divides by items.length, so
    // keep only items with a non-empty `t` (and coerce done to a real boolean); an
    // empty payload keeps the seed rather than a 0/0 → NaN% progress bar.
    const c = res.payload as { items?: unknown[] };
    const items = Array.isArray(c.items)
      ? c.items
          .filter(
            (it): it is { t: string; done?: unknown } =>
              !!it &&
              typeof it === 'object' &&
              typeof (it as { t?: unknown }).t === 'string' &&
              (it as { t: string }).t.trim().length > 0,
          )
          .map((it) => ({ t: it.t, done: it.done === true }))
      : [];
    if (items.length) {
      t.checklist = items;
      const out = deriveOut('checklist', res.payload);
      if (out) t.out = out;
    }
  } else if (type === 'plan' && res.payload) {
    // PlanViewer reads goal / steps[] / changes[].{area,edit} / verify[] / risks.
    // Require a goal + at least one step, else keep the seed (never render an empty,
    // meaningless plan). Drop any change/verify entry missing its text.
    const p = res.payload as {
      goal?: unknown;
      steps?: unknown[];
      changes?: unknown[];
      verify?: unknown[];
      risks?: unknown;
    };
    const goal = typeof p.goal === 'string' ? p.goal.trim() : '';
    const steps = Array.isArray(p.steps)
      ? p.steps.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      : [];
    const changes = Array.isArray(p.changes)
      ? p.changes
          .filter(
            (c): c is { area: string; edit: string } =>
              !!c &&
              typeof c === 'object' &&
              typeof (c as { area?: unknown }).area === 'string' &&
              (c as { area: string }).area.trim().length > 0 &&
              typeof (c as { edit?: unknown }).edit === 'string' &&
              (c as { edit: string }).edit.trim().length > 0,
          )
          .map((c) => ({ area: c.area, edit: c.edit }))
      : [];
    const verify = Array.isArray(p.verify)
      ? p.verify.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      : [];
    if (goal && steps.length) {
      t.plan = { goal, steps, changes, verify, risks: typeof p.risks === 'string' ? p.risks : '' };
      const out = deriveOut('plan', t.plan);
      if (out) t.out = out;
    }
  } else if (type === 'sheet' && res.payload) {
    // Rebuild the fixed 4-input array (clamped/finite) from byte's values; keep the
    // seed if the payload is unusable. The summary becomes the library `out` text.
    const inputs = buildSheetInputs(res.payload);
    if (inputs) {
      t.sheet = { inputs };
      const summary = (res.payload as { summary?: unknown }).summary;
      if (typeof summary === 'string' && summary.trim()) t.out = summary;
    }
  } else if (type === 'site' && res.payload) {
    // Render byte's structured spec into the fixed HTML template (code owns the
    // markup). Keep the seed if the payload can't make a real page. Stash the spec
    // so a later revise pass edits the spec, not the HTML; sub becomes library text.
    const html = renderSiteHtml(res.payload);
    if (html) {
      t.site = html;
      t.siteSpec = res.payload as Record<string, unknown>;
      const sub = (res.payload as { sub?: unknown }).sub;
      if (typeof sub === 'string' && sub.trim()) t.out = sub;
    }
  } else if (typeof res.text === 'string' && res.text) {
    t.out = res.text;
  }
}
