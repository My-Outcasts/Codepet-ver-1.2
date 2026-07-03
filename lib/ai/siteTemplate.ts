// Pure renderer: turns byte's structured site spec into a complete, self-contained
// HTML landing page using a FIXED template. This is the safety boundary — byte
// never writes markup. It only fills text fields (all HTML-escaped here) and a
// single accent colour (sanitized to a strict 6-digit hex). Code owns every tag,
// class, and rule, so a hostile/garbled payload can't inject scripts or break out
// of the template. Kept dependency-free so it's unit-testable in plain node and
// safe to import from the client (ArtifactModal) without pulling the SDK.

export interface SiteStep {
  h: string;
  p: string;
}

export interface SiteSpec {
  title: string;
  brand: string;
  kicker: string;
  headline: string;
  headlineHi: string;
  sub: string;
  ctaPrimary: string;
  ctaSecondary: string;
  howEyebrow: string;
  howTitle: string;
  steps: SiteStep[];
  featEyebrow: string;
  featTitle: string;
  features: SiteStep[];
  quote: string;
  quoteBy: string;
  finalTitle: string;
  finalSub: string;
  finalCta: string;
  accent: string;
  footNote: string;
}

const DEFAULT_ACCENT = '#6e8e68';

/** HTML-escape a text field before it goes anywhere near the template. */
export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only accept a plain `#rrggbb` (or `#rgb`) hex; anything else → the brand green.
 *  The accent is interpolated into a <style> block, so this guards against CSS
 *  injection (`}</style>…`) via the one non-escaped field. */
export function safeHex(v: unknown): string {
  const s = String(v ?? '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    const [r, g, b] = s.slice(1);
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return DEFAULT_ACCENT;
}

/** Darken a validated hex by `f` (0–1) for the deeper accent shade. */
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - f));
  const g = Math.round(((n >> 8) & 255) * (1 - f));
  const b = Math.round((n & 255) * (1 - f));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.trim() ? v : fallback;
}

function steps(v: unknown): SiteStep[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => ({ h: str(s.h), p: str(s.p) }))
    .filter((s) => s.h || s.p)
    .slice(0, 6);
}

/** Normalize an untrusted payload into a SiteSpec, or `null` if it can't make a
 *  real page (no steps AND no features means byte returned nothing usable). */
export function normalizeSiteSpec(payload: unknown): SiteSpec | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const st = steps(p.steps);
  const ft = steps(p.features);
  if (!st.length && !ft.length) return null;
  return {
    title: str(p.title, 'A product worth understanding'),
    brand: str(p.brand, 'Your company'),
    kicker: str(p.kicker),
    headline: str(p.headline, 'Build something real.'),
    headlineHi: str(p.headlineHi),
    sub: str(p.sub),
    ctaPrimary: str(p.ctaPrimary, 'Get started'),
    ctaSecondary: str(p.ctaSecondary),
    howEyebrow: str(p.howEyebrow, 'How it works'),
    howTitle: str(p.howTitle, 'How it works'),
    steps: st,
    featEyebrow: str(p.featEyebrow, 'Why it matters'),
    featTitle: str(p.featTitle, 'What you get'),
    features: ft,
    quote: str(p.quote),
    quoteBy: str(p.quoteBy),
    finalTitle: str(p.finalTitle, 'Ready when you are.'),
    finalSub: str(p.finalSub),
    finalCta: str(p.finalCta, str(p.ctaPrimary, 'Get started')),
    accent: safeHex(p.accent),
    footNote: str(p.footNote),
  };
}

const cell = (s: SiteStep, n?: number): string =>
  `<div class="step">${n ? `<div class="n">${n}</div>` : ''}<h3>${esc(s.h)}</h3><p>${esc(s.p)}</p></div>`;

/** Render the fixed template. Returns the full HTML document string, or `null`
 *  if the payload can't be normalized into a real page. */
export function renderSiteHtml(payload: unknown): string | null {
  const s = normalizeSiteSpec(payload);
  if (!s) return null;
  const accent = s.accent;
  const accent2 = shade(accent, 0.16);

  const hero =
    `<div class="wrap"><header>` +
    (s.kicker ? `<div class="kicker">${esc(s.kicker)}</div>` : '') +
    `<h1>${esc(s.headline)}${s.headlineHi ? ` <span class="hl">${esc(s.headlineHi)}</span>` : ''}</h1>` +
    (s.sub ? `<p class="sub">${esc(s.sub)}</p>` : '') +
    `<div class="cta"><a class="btn p" href="#">${esc(s.ctaPrimary)}</a>` +
    (s.ctaSecondary ? `<a class="btn g" href="#">${esc(s.ctaSecondary)}</a>` : '') +
    `</div></header></div>`;

  const how = s.steps.length
    ? `<div class="wrap" id="how"><section>` +
      `<div class="eyebrow">${esc(s.howEyebrow)}</div><h2>${esc(s.howTitle)}</h2>` +
      `<div class="steps">${s.steps.map((st, i) => cell(st, i + 1)).join('')}</div>` +
      `</section></div>`
    : '';

  const feat = s.features.length
    ? `<div class="wrap" id="features"><section>` +
      `<div class="eyebrow">${esc(s.featEyebrow)}</div><h2>${esc(s.featTitle)}</h2>` +
      `<div class="feat">${s.features.map((f) => cell(f)).join('')}</div>` +
      `</section></div>`
    : '';

  const quote = s.quote
    ? `<div class="wrap"><section><p class="quote">${esc(s.quote)}` +
      (s.quoteBy ? `<span>${esc(s.quoteBy)}</span>` : '') +
      `</p></section></div>`
    : '';

  const final =
    `<div class="wrap"><div class="final"><h2>${esc(s.finalTitle)}</h2>` +
    (s.finalSub ? `<p class="fsub">${esc(s.finalSub)}</p>` : '') +
    `<a class="btn p" href="#">${esc(s.finalCta)}</a></div></div>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(s.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@400;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--page:#efece4;--ink:#2b2a26;--ink2:#5d5b53;--accent:${accent};--accent2:${accent2};--card:#fbf9f4;--line:#e3ddd0}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,system-ui,sans-serif;background:var(--page);color:var(--ink);line-height:1.5;-webkit-font-smoothing:antialiased}
.wrap{max-width:1080px;margin:0 auto;padding:0 28px}
nav{display:flex;align-items:center;gap:26px;padding:22px 0}
.logo{font-family:'Pixelify Sans',monospace;font-weight:700;font-size:20px;display:flex;align-items:center;gap:9px}
.logo .b{width:26px;height:26px;border-radius:7px;background:var(--accent);display:inline-block;position:relative;flex:none}
.logo .b:before{content:"";position:absolute;left:6px;top:9px;width:4px;height:4px;background:#fff;box-shadow:10px 0 #fff}
nav .nl{margin-left:auto;display:flex;gap:24px;font-size:14px;color:var(--ink2)}
nav a{color:inherit;text-decoration:none}
.btn{font-family:inherit;font-size:14px;font-weight:600;padding:10px 18px;border-radius:10px;border:0;cursor:pointer;text-decoration:none;display:inline-block}
.btn.p{background:var(--accent);color:#fff}
.btn.g{background:transparent;color:var(--ink);border:1px solid var(--line)}
header{text-align:center;padding:66px 0 24px}
.kicker{font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent2);margin-bottom:20px}
h1{font-family:'Pixelify Sans',monospace;font-size:56px;line-height:1.06;letter-spacing:-.5px;margin-bottom:22px}
h1 .hl{color:var(--accent)}
.sub{font-size:19px;color:var(--ink2);max-width:600px;margin:0 auto 30px}
.cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
section{padding:56px 0}
.eyebrow{font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent2);text-align:center;margin-bottom:12px}
h2{font-family:'Pixelify Sans',monospace;font-size:34px;text-align:center;margin-bottom:44px}
.steps,.feat{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}
.step{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:26px}
.step .n{font-family:'Pixelify Sans',monospace;font-size:13px;color:#fff;background:var(--accent);width:30px;height:30px;border-radius:8px;display:grid;place-items:center;margin-bottom:16px}
.step h3{font-family:'Pixelify Sans',monospace;font-size:18px;margin-bottom:8px}
.step p{font-size:14px;color:var(--ink2)}
.quote{text-align:center;max-width:720px;margin:0 auto;font-size:24px;font-family:'Pixelify Sans',monospace;line-height:1.4}
.quote span{color:var(--ink2);font-family:Inter;font-size:14px;display:block;margin-top:18px}
.final{background:var(--accent);color:#fff;border-radius:20px;text-align:center;padding:58px 28px;margin:24px 0 64px}
.final h2{color:#fff;margin-bottom:14px}
.final .fsub{opacity:.9;margin-bottom:24px;font-size:17px}
.final .btn.p{background:#fff;color:var(--accent2)}
footer{border-top:1px solid var(--line);padding:26px 0;display:flex;align-items:center;gap:16px;font-size:13px;color:var(--ink2);flex-wrap:wrap}
footer .logo{font-size:16px}
@media(max-width:760px){h1{font-size:38px}.steps,.feat{grid-template-columns:1fr}nav .nl{display:none}}
</style></head><body>
<div class="wrap"><nav>
  <div class="logo"><span class="b"></span>${esc(s.brand)}</div>
  <div class="nl">${s.steps.length ? '<a href="#how">How it works</a>' : ''}${s.features.length ? '<a href="#features">Features</a>' : ''}</div>
  <a class="btn p" href="#">${esc(s.ctaPrimary)}</a>
</nav></div>
${hero}
${how}
${feat}
${quote}
${final}
<div class="wrap"><footer>
  <div class="logo"><span class="b"></span>${esc(s.brand)}</div>
  <span style="margin-left:auto">${esc(s.footNote)}</span>
</footer></div>
</body></html>`;
}
