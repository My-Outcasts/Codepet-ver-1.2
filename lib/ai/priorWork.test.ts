import { describe, it, expect } from 'vitest';
import { selectPriorWork, composePriorWorkContext, type PriorItem } from './priorWork';

const item = (over: Partial<PriorItem>): PriorItem => ({
  title: 'Untitled',
  dept: 'Marketing',
  k: 'mkt',
  type: 'post',
  out: 'some output',
  ...over,
});

describe('selectPriorWork', () => {
  it('returns [] for empty input', () => {
    expect(selectPriorWork([])).toEqual([]);
  });

  it('drops items with no title or no out', () => {
    const items = [item({ title: '' }), item({ out: '  ' }), item({ title: 'Keep' })];
    expect(selectPriorWork(items).map((i) => i.title)).toEqual(['Keep']);
  });

  it('excludes the current task by title (case/space-insensitive)', () => {
    const items = [item({ title: 'Landing Page' }), item({ title: 'Pricing' })];
    const picked = selectPriorWork(items, { excludeTitle: '  landing page ' });
    expect(picked.map((i) => i.title)).toEqual(['Pricing']);
  });

  it('caps at max (default 4), preserving newest-first order', () => {
    const items = Array.from({ length: 8 }, (_, i) => item({ title: `T${i}`, dept: 'X' }));
    expect(selectPriorWork(items).map((i) => i.title)).toEqual(['T0', 'T1', 'T2', 'T3']);
  });

  it('prioritizes same-department work, then fills with other departments', () => {
    // newest-first; current dept = Finance. sameDeptMax=2, max=4.
    const items = [
      item({ title: 'M1', dept: 'Marketing' }),
      item({ title: 'F1', dept: 'Finance' }),
      item({ title: 'M2', dept: 'Marketing' }),
      item({ title: 'F2', dept: 'Finance' }),
      item({ title: 'F3', dept: 'Finance' }),
    ];
    const picked = selectPriorWork(items, { deptName: 'Finance' });
    // 2 newest Finance (F1, F2), then cross-dept newest (M1, M2) fills to 4.
    expect(picked.map((i) => i.title)).toEqual(['F1', 'F2', 'M1', 'M2']);
  });

  it('tops up with leftover same-dept work when no other departments exist', () => {
    const items = [
      item({ title: 'F1', dept: 'Finance' }),
      item({ title: 'F2', dept: 'Finance' }),
      item({ title: 'F3', dept: 'Finance' }),
    ];
    const picked = selectPriorWork(items, { deptName: 'Finance' });
    expect(picked.map((i) => i.title)).toEqual(['F1', 'F2', 'F3']);
  });

  it('never returns the same title twice', () => {
    const items = [
      item({ title: 'Dup', dept: 'Finance' }),
      item({ title: 'Dup', dept: 'Finance' }),
    ];
    expect(selectPriorWork(items, { deptName: 'Finance' })).toHaveLength(1);
  });
});

describe('selectPriorWork — relevance mode (query given)', () => {
  it('ranks a relevant cross-dept item above an irrelevant same-dept one', () => {
    const items = [
      item({ title: 'Brand palette', dept: 'Marketing', out: 'muted greens' }),
      item({ title: 'Pricing sheet', dept: 'Finance', out: 'three tiers' }),
    ];
    const picked = selectPriorWork(items, {
      deptName: 'Marketing',
      query: 'Write the launch post referencing our pricing',
    });
    // "pricing" matches the Finance sheet's title (weight 3) and beats the same-dept
    // palette's dept bonus (2), so the relevant cross-dept item leads.
    expect(picked.map((i) => i.title)).toEqual(['Pricing sheet', 'Brand palette']);
  });

  it('weights a title match above a body match', () => {
    const items = [
      item({ title: 'Roadmap', out: 'notes on pricing and pricing tiers' }),
      item({ title: 'Pricing plan', out: 'unrelated body' }),
    ];
    const picked = selectPriorWork(items, { query: 'pricing' });
    expect(picked.map((i) => i.title)).toEqual(['Pricing plan', 'Roadmap']);
  });

  it('uses the same-department bonus to break ties when nothing matches', () => {
    const items = [
      item({ title: 'M', dept: 'Marketing', out: 'aaa' }),
      item({ title: 'F', dept: 'Finance', out: 'bbb' }),
    ];
    const picked = selectPriorWork(items, { deptName: 'Finance', query: 'zzz' });
    expect(picked.map((i) => i.title)).toEqual(['F', 'M']);
  });

  it('still excludes the current task by title in relevance mode', () => {
    const items = [
      item({ title: 'Pricing', out: 'the current one' }),
      item({ title: 'Positioning', out: 'our pricing tone of voice' }),
    ];
    const picked = selectPriorWork(items, { query: 'pricing', excludeTitle: 'pricing' });
    expect(picked.map((i) => i.title)).toEqual(['Positioning']);
  });

  it('falls back to recency when the query has no content tokens (stopwords only)', () => {
    const items = [item({ title: 'A', dept: 'X' }), item({ title: 'B', dept: 'X' })];
    // "the a of" → all stopwords / too short → empty token set → recency fallback.
    expect(selectPriorWork(items, { query: 'the a of' }).map((i) => i.title)).toEqual(['A', 'B']);
  });
});

describe('composePriorWorkContext', () => {
  it('returns empty string for no items', () => {
    expect(composePriorWorkContext([])).toBe('');
  });

  it('renders one line per item with dept, title, and type', () => {
    const block = composePriorWorkContext([
      item({ title: 'Pricing', dept: 'Finance', type: 'sheet', out: 'Tiers: $9 / $29' }),
    ]);
    expect(block).toContain('[Finance] Pricing (sheet): Tiers: $9 / $29');
    expect(block.startsWith('Already-approved work')).toBe(true);
  });

  it('truncates long output and collapses whitespace', () => {
    const long = 'word '.repeat(300); // ~1500 chars, whitespace-heavy
    const block = composePriorWorkContext([item({ out: long })]);
    const rendered = block.split(': ').slice(1).join(': ');
    expect(rendered.length).toBeLessThanOrEqual(500);
    expect(rendered).not.toContain('  '); // whitespace collapsed
  });
});
