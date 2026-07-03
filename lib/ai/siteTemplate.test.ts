import { describe, it, expect } from 'vitest';
import { renderSiteHtml, normalizeSiteSpec, esc, safeHex } from './siteTemplate';

const good = {
  title: 'Acme — do more',
  brand: 'Acme',
  kicker: 'macOS',
  headline: 'Ship it',
  headlineHi: 'faster',
  sub: 'The subline.',
  ctaPrimary: 'Get started',
  ctaSecondary: 'Learn more',
  howEyebrow: 'How it works',
  howTitle: 'Three steps',
  steps: [
    { h: 'One', p: 'First.' },
    { h: 'Two', p: 'Second.' },
    { h: 'Three', p: 'Third.' },
  ],
  featEyebrow: 'Why',
  featTitle: 'What you get',
  features: [
    { h: 'A', p: 'aa' },
    { h: 'B', p: 'bb' },
    { h: 'C', p: 'cc' },
  ],
  quote: 'Great tool.',
  quoteBy: '— a user',
  finalTitle: 'Ready?',
  finalSub: 'Join today.',
  finalCta: 'Sign up',
  accent: '#3366CC',
  footNote: '© 2026 Acme',
};

describe('safeHex', () => {
  it('accepts a 6-digit hex and lowercases it', () => {
    expect(safeHex('#3366CC')).toBe('#3366cc');
  });
  it('expands a 3-digit hex', () => {
    expect(safeHex('#3ac')).toBe('#33aacc');
  });
  it('falls back to the brand green on anything else (incl. CSS-injection attempts)', () => {
    expect(safeHex('red')).toBe('#6e8e68');
    expect(safeHex('#3366CC}</style><script>')).toBe('#6e8e68');
    expect(safeHex(null)).toBe('#6e8e68');
  });
});

describe('esc', () => {
  it('escapes every HTML-significant character', () => {
    expect(esc(`<b>"x"&'y'`)).toBe('&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;');
  });
});

describe('normalizeSiteSpec', () => {
  it('returns null when there are neither steps nor features', () => {
    expect(normalizeSiteSpec({ ...good, steps: [], features: [] })).toBeNull();
    expect(normalizeSiteSpec(null)).toBeNull();
    expect(normalizeSiteSpec('nope')).toBeNull();
  });
  it('survives a partial payload by filling sane defaults', () => {
    const s = normalizeSiteSpec({ steps: [{ h: 'x', p: 'y' }] });
    expect(s?.brand).toBeTruthy();
    expect(s?.ctaPrimary).toBeTruthy();
    expect(s?.features).toEqual([]);
  });
  it('drops empty/garbage cards and caps the count', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ h: `h${i}`, p: `p${i}` }));
    const s = normalizeSiteSpec({ ...good, steps: [{ h: '', p: '' }, ...many] });
    expect(s?.steps.length).toBeLessThanOrEqual(6);
    expect(s?.steps.every((c) => c.h || c.p)).toBe(true);
  });
});

describe('renderSiteHtml', () => {
  it('returns null for an unusable payload', () => {
    expect(renderSiteHtml({})).toBeNull();
    expect(renderSiteHtml(undefined)).toBeNull();
  });

  it('renders a complete HTML document with the content', () => {
    const html = renderSiteHtml(good)!;
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
    expect(html).toContain('<title>Acme — do more</title>');
    expect(html).toContain('Ship it');
    expect(html).toContain('faster');
    expect(html).toContain('Get started');
    // sanitized accent lands in the stylesheet.
    expect(html).toContain('--accent:#3366cc');
    // all three steps + features present.
    for (const c of ['One', 'Two', 'Three', 'aa', 'bb', 'cc']) expect(html).toContain(c);
  });

  it('escapes hostile content instead of emitting raw markup', () => {
    const html = renderSiteHtml({
      ...good,
      brand: '<script>alert(1)</script>',
      headline: 'Hi <img src=x onerror=alert(1)>',
    })!;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });

  it('omits optional blocks when their fields are empty strings', () => {
    const html = renderSiteHtml({
      ...good,
      kicker: '',
      headlineHi: '',
      ctaSecondary: '',
      quote: '',
      quoteBy: '',
      finalSub: '',
    })!;
    expect(html).not.toContain('class="kicker"');
    expect(html).not.toContain('class="hl"');
    expect(html).not.toContain('class="quote"');
    expect(html).not.toContain('btn g'); // no secondary CTA
  });
});
