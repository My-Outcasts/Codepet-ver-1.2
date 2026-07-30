// The run's TRUTHFUL trace. Every line here is derived from state the server actually
// loaded and fed to the model on THIS run — this module exists so that claim is
// unit-testable. It is pure: no Firestore, no network, no clock.
//
// Deliberately NOT lib/helpers.ts:buildLog, which returns hardcoded strings per
// deliverable type ("218 tests passed", invented diffs). Nothing here may do that.
import type { PriorItem } from './priorWork';
import type { CompanyBrief } from '../firebase/schema';

export type RunPhase = 'brief' | 'prior' | 'generate' | 'verify';

/** One quoted fact and where it came from. The quote is verbatim founder/company content. */
export interface Evidence {
  quote: string;
  source: string;
}

export interface RunStep {
  phase: RunPhase;
  label: string;
  /** Where the step read from — shown as a chip. Omitted when the step reads nothing. */
  source?: string;
  evidence: Evidence[];
}

export type RunEvent =
  | { type: 'step'; step: RunStep }
  | { type: 'active'; phase: RunPhase }
  | { type: 'usage'; credits: number }
  | { type: 'result'; text?: string; payload?: unknown }
  | { type: 'error'; code: string };

const MAX_QUOTE = 160;

/** Collapse whitespace and cap length so a pasted README can't flood the rail. */
function quote(raw: string): string {
  const s = raw.trim().replace(/\s+/g, ' ');
  return s.length > MAX_QUOTE ? s.slice(0, MAX_QUOTE - 1) + '…' : s;
}

/** Brief fields worth showing, in the order they carry signal. Keep in sync with the
 *  fields composeProjectModel actually feeds the model (lib/ai/projectModel.ts). */
const BRIEF_FIELDS: ReadonlyArray<[keyof CompanyBrief, string]> = [
  ['oneLiner', 'your one-liner'],
  ['summary', 'byte’s read of the product'],
  ['audience', 'who it’s for'],
  ['goal', 'what you’re aiming at'],
  ['stage', 'your stage'],
  ['notes', 'your notes'],
];

export function briefStep(brief: CompanyBrief | undefined): RunStep | null {
  if (!brief) return null;
  const evidence: Evidence[] = [];
  for (const [key, source] of BRIEF_FIELDS) {
    const v = brief[key];
    if (typeof v === 'string' && v.trim()) evidence.push({ quote: quote(v), source });
  }
  if (!evidence.length) return null;
  return { phase: 'brief', label: 'Read your Business Brief', source: 'Brief', evidence };
}

export function priorWorkStep(items: PriorItem[]): RunStep | null {
  if (!items.length) return null;
  return {
    phase: 'prior',
    label: `Pulled ${items.length} piece${items.length === 1 ? '' : 's'} of your approved work`,
    source: 'Library',
    evidence: items.map((i) => ({ quote: i.title, source: `${i.dept} · ${i.type}` })),
  };
}

export function generateStep(kind: string, deptName: string | undefined): RunStep {
  return {
    phase: 'generate',
    label: deptName ? `Writing the ${deptName} deliverable` : 'Writing the deliverable',
    evidence: [],
  };
}
