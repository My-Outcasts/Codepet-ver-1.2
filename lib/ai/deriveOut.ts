// Phase 6.4 — outcome personalization for live structured deliverables.
//
// A completed task shows a plain-text `out` summary (the "✓ …" outcome line typed
// out on the deliver screen and shown in the library). For `text`/`sheet`/`site`
// that line already comes from the live payload, but `post`/`email`/`legal`/
// `screens` used to fall back to the hardcoded Codepet seed — so a founder's own
// company would still read Codepet's story. deriveOut turns each structured payload
// into a short, company-specific outcome in byte's voice.
//
// Pure and defensive: returns null when the payload can't make a real summary, so
// the caller keeps the seed rather than showing a broken line. No markup, no arrows
// (house style) — plain text with `·` separators.

type DeriveKind = 'post' | 'email' | 'legal' | 'screens';

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Non-empty trimmed strings pulled from an array field, in order. */
function pick(arr: unknown, key: string): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((row) => (row && typeof row === 'object' ? str((row as Record<string, unknown>)[key]) : ''))
    .filter(Boolean);
}

function fromPost(p: Record<string, unknown>): string | null {
  const variants = p.variants;
  if (!Array.isArray(variants) || variants.length === 0) return null;
  const first = variants[0];
  const lead = first && typeof first === 'object' ? str((first as Record<string, unknown>).body) : '';
  if (!lead) return null;
  const labels = pick(variants, 'label');
  const angles = labels.length ? `\n\nAngles: ${labels.join(' · ')}.` : '';
  return `✓ ${variants.length} launch-post variant${variants.length === 1 ? '' : 's'} ready to A/B.${angles}\n\nLead option:\n${lead}`;
}

function fromEmail(p: Record<string, unknown>): string | null {
  const subject = str(p.subject);
  if (!subject) return null;
  const lines = [`✓ Launch email drafted — subject: "${subject}".`];
  const preheader = str(p.preheader);
  if (preheader) lines.push('', preheader);
  const cta = str(p.cta);
  const whens = pick(p.seq, 'when');
  const tail: string[] = [];
  if (cta) tail.push(`CTA: ${cta}.`);
  if (whens.length) tail.push(`Plus a ${whens.length}-step follow-up (${whens.join(', ')}).`);
  if (tail.length) lines.push('', tail.join(' '));
  return lines.join('\n');
}

function fromLegal(p: Record<string, unknown>): string | null {
  const heads = pick(p.sections, 'h');
  if (heads.length === 0) return null;
  const title = str(p.docTitle) || 'Legal document';
  const lines = [
    `✓ ${title} drafted — ${heads.length} section${heads.length === 1 ? '' : 's'}.`,
    '',
    `Sections: ${heads.join(' · ')}.`,
  ];
  const flag = str(p.flag);
  if (flag) lines.push('', `Reviewer note: ${flag}`);
  return lines.join('\n');
}

function fromScreens(p: Record<string, unknown>): string | null {
  const screens = p.screens;
  if (!Array.isArray(screens) || screens.length === 0) return null;
  const names = pick(screens, 'name');
  if (names.length === 0) return null;
  const detail = screens
    .map((s) => {
      if (!s || typeof s !== 'object') return '';
      const row = s as Record<string, unknown>;
      const name = str(row.name);
      if (!name) return '';
      const time = str(row.time);
      const title = str(row.title);
      const bits = [name];
      if (time) bits.push(`(${time})`);
      return title ? `${bits.join(' ')} — ${title}` : bits.join(' ');
    })
    .filter(Boolean);
  return `✓ Onboarding flow ready — ${names.length} screen${names.length === 1 ? '' : 's'}: ${names.join(' · ')}.\n\n${detail.join('\n')}`;
}

/**
 * Build a personalized `out` outcome line from a live structured payload.
 * Returns null for kinds handled elsewhere (text/sheet/site) or when the payload
 * is unusable — the caller keeps the existing seed in that case.
 */
export function deriveOut(type: string, payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  switch (type as DeriveKind) {
    case 'post':
      return fromPost(p);
    case 'email':
      return fromEmail(p);
    case 'legal':
      return fromLegal(p);
    case 'screens':
      return fromScreens(p);
    default:
      return null;
  }
}
