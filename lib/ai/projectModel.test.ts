import { describe, it, expect } from 'vitest';
import {
  composeShippedDigest,
  composeProjectModel,
  normalizeDecisions,
  composeDecisions,
  MAX_DECISIONS,
} from './projectModel';
import type { PriorItem } from './priorWork';

const item = (over: Partial<PriorItem>): PriorItem => ({
  title: 'Untitled',
  dept: 'Marketing',
  k: 'mkt',
  type: 'post',
  out: 'x',
  ...over,
});

// A brief that briefToContext will turn into a non-null narrative.
const BRIEF = { projectName: 'Acme', oneLiner: 'Ship faster', audience: 'devs' };

describe('composeShippedDigest', () => {
  it('is empty for no items', () => {
    expect(composeShippedDigest([])).toBe('');
  });

  it('groups titles by department, separated by · ', () => {
    const digest = composeShippedDigest([
      item({ title: 'Landing page', dept: 'Marketing' }),
      item({ title: 'Pricing model', dept: 'Finance' }),
      item({ title: 'Launch post', dept: 'Marketing' }),
    ]);
    expect(digest).toBe('Marketing: Landing page, Launch post · Finance: Pricing model');
  });

  it('caps titles per department', () => {
    const items = Array.from({ length: 6 }, (_, i) => item({ title: `T${i}`, dept: 'Eng' }));
    expect(composeShippedDigest(items, { maxPerDept: 2 })).toBe('Eng: T0, T1');
  });

  it('caps total items across departments', () => {
    const items = [
      item({ title: 'A', dept: 'X' }),
      item({ title: 'B', dept: 'Y' }),
      item({ title: 'C', dept: 'Z' }),
    ];
    expect(composeShippedDigest(items, { maxItems: 2 })).toBe('X: A · Y: B');
  });

  it('skips blank titles and falls back to General for a blank department', () => {
    const digest = composeShippedDigest([item({ title: '  ' }), item({ title: 'Keep', dept: '' })]);
    expect(digest).toBe('General: Keep');
  });
});

describe('composeProjectModel', () => {
  it('returns empty string with no usable signal', () => {
    expect(composeProjectModel({ brief: null })).toBe('');
  });

  it('includes the brief narrative when present', () => {
    const model = composeProjectModel({ brief: BRIEF });
    expect(model).toContain('Acme');
  });

  it('falls back to the client brief when the persisted one is empty', () => {
    const model = composeProjectModel({ brief: null, fallbackBrief: BRIEF });
    expect(model).toContain('Acme');
  });

  it('appends the shipped digest on its own line', () => {
    const model = composeProjectModel({
      brief: BRIEF,
      shipped: [item({ title: 'Pricing', dept: 'Finance' })],
    });
    const lines = model.split('\n');
    expect(
      lines.some((l) => l.startsWith('What the company has shipped so far — Finance: Pricing')),
    ).toBe(true);
  });

  it('appends the current focus with its reason', () => {
    const model = composeProjectModel({
      brief: BRIEF,
      focus: { title: 'Ship the waitlist', why: 'it unblocks launch' },
    });
    expect(model).toContain('Current focus: Ship the waitlist — it unblocks launch.');
  });

  it('builds a model from shipped work alone even without a brief', () => {
    const model = composeProjectModel({ brief: null, shipped: [item({ title: 'Logo' })] });
    expect(model).toBe('What the company has shipped so far — Marketing: Logo.');
  });

  it('omits the focus line when the title is blank', () => {
    const model = composeProjectModel({ brief: BRIEF, focus: { title: '   ' } });
    expect(model).not.toContain('Current focus');
  });

  it('includes locked-in decisions when present', () => {
    const model = composeProjectModel({
      brief: BRIEF,
      decisions: [{ topic: 'pricing', statement: 'Plus is $4/mo' }],
    });
    expect(model).toContain('Decisions the founder has locked in');
    expect(model).toContain('- pricing: Plus is $4/mo');
  });
});

describe('normalizeDecisions', () => {
  it('returns [] for non-array input', () => {
    expect(normalizeDecisions(null)).toEqual([]);
    expect(normalizeDecisions('nope')).toEqual([]);
    expect(normalizeDecisions({ topic: 'x' })).toEqual([]);
  });

  it('keeps only entries with a non-empty topic and statement, trimmed', () => {
    const out = normalizeDecisions([
      { topic: ' pricing ', statement: ' $4/mo ' },
      { topic: '', statement: 'no topic' },
      { topic: 'naming', statement: '  ' },
      { statement: 'no topic key' },
      'garbage',
      null,
    ]);
    expect(out).toEqual([
      { topic: 'pricing', statement: '$4/mo', source: undefined, updatedAt: undefined },
    ]);
  });

  it('preserves valid source and updatedAt, drops invalid ones', () => {
    const out = normalizeDecisions([
      { topic: 't', statement: 's', source: ' Finance ', updatedAt: 123 },
      { topic: 'u', statement: 'v', source: '  ', updatedAt: Number.NaN },
    ]);
    expect(out[0]).toEqual({ topic: 't', statement: 's', source: 'Finance', updatedAt: 123 });
    expect(out[1]).toEqual({ topic: 'u', statement: 'v', source: undefined, updatedAt: undefined });
  });

  it('caps at MAX_DECISIONS, keeping the most recently updated', () => {
    const many = Array.from({ length: MAX_DECISIONS + 5 }, (_, i) => ({
      topic: `t${i}`,
      statement: 's',
      updatedAt: i, // higher i = newer
    }));
    const out = normalizeDecisions(many);
    expect(out).toHaveLength(MAX_DECISIONS);
    // The oldest 5 (updatedAt 0-4) are dropped; the newest is kept.
    expect(out.some((d) => d.topic === `t${MAX_DECISIONS + 4}`)).toBe(true);
    expect(out.some((d) => d.topic === 't0')).toBe(false);
  });
});

describe('composeDecisions', () => {
  it('is empty for no decisions', () => {
    expect(composeDecisions([])).toBe('');
  });

  it('renders one line per decision under an honor-these header', () => {
    const block = composeDecisions([
      { topic: 'pricing', statement: 'Plus is $4/mo' },
      { topic: 'positioning', statement: 'lead with roommate money-tension' },
    ]);
    expect(block).toContain('honor these');
    expect(block).toContain('- pricing: Plus is $4/mo');
    expect(block).toContain('- positioning: lead with roommate money-tension');
  });

  it('tells byte to flag a conflict rather than silently override it', () => {
    const block = composeDecisions([{ topic: 'pricing', statement: 'no lifetime deal' }]);
    expect(block).toContain('do NOT quietly override');
    expect(block.toLowerCase()).toContain('flag');
  });
});
