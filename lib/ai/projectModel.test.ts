import { describe, it, expect } from 'vitest';
import { composeShippedDigest, composeProjectModel } from './projectModel';
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
});
