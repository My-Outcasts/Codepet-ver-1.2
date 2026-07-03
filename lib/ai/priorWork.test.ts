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
