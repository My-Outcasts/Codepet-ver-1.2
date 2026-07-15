/**
 * Codepet — chat readability audit probe (Conversation with Codepet).
 * -----------------------------------------------------------------
 * This is a BROWSER-CONSOLE script, not a Node script. Paste it into
 * DevTools → Console on any Codepet page (preview or prod — it works
 * even on the splash, no login required) to re-audit the chat copilot's
 * text size and contrast. It injects hidden `.bub` / `.composer-in`
 * nodes so the REAL deployed globals.css rules apply, measures both
 * light and dark themes, restores the theme, and cleans up after itself.
 * Nothing is persisted.
 *
 * See docs/testing/chat-readability.md for the full guide.
 *
 * Assertions:
 *   A1 .bub          font-size == 14.5px
 *   A2 .composer-in  font-size == 14.5px
 *   A3 .bub (byte)   color     == --t-1
 *   A4 .composer-in  color     == --t-1
 *   A5 contrast light: byte-on-surface & user-on-tint >= 7:1 (WCAG AAA)
 *   A6 contrast dark : byte-on-surface & user-on-tint >= 7:1
 *   B1 .bub.me       color     == --t-2   (deliberately unchanged)
 *   B4 .byte-thinking color    == --t-3   (unchanged, stays faint)
 *   B3 .bub          max-width == 94%     (no layout blow-out)
 *
 * Tune EXPECT_SIZE / MIN_CONTRAST below if the design baseline changes
 * (e.g. set MIN_CONTRAST = 4.5 to audit against WCAG AA instead of AAA).
 */
(() => {
  const EXPECT_SIZE = 14.5; // px
  const MIN_CONTRAST = 7; // WCAG AAA for normal text

  // --- helpers ---------------------------------------------------
  const root = document.documentElement;
  const toRGB = (c) => {
    const d = document.createElement('div');
    d.style.color = c;
    document.body.appendChild(d);
    const rgb = getComputedStyle(d).color;
    d.remove();
    return rgb;
  };
  const nums = (rgb) => rgb.match(/\d+(\.\d+)?/g).map(Number);
  const srgb = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const lum = (rgb) => {
    const [r, g, b] = nums(rgb);
    return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  };
  const contrast = (fg, bg) => {
    const a = lum(toRGB(fg)),
      b = lum(toRGB(bg));
    const hi = Math.max(a, b),
      lo = Math.min(a, b);
    return +((hi + 0.05) / (lo + 0.05)).toFixed(2);
  };
  const same = (a, b) => toRGB(a) === toRGB(b);
  const cvar = (v) => getComputedStyle(root).getPropertyValue(v).trim();

  // --- inject representative chat nodes (real globals.css applies) -
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-9999px;top:0;width:360px;';
  host.innerHTML =
    '<div class="copilot"><div class="cop-body">' +
    '<div class="bub" id="_p_byte">byte reply</div>' +
    '<div class="bub me" id="_p_me">my message</div>' +
    '<div class="bub byte-thinking" id="_p_think">thinking</div>' +
    '</div><div class="composer"><textarea class="composer-in" id="_p_in"></textarea></div></div>';
  document.body.appendChild(host);
  const cs = (id) => getComputedStyle(document.getElementById(id));

  const results = [];
  const add = (id, label, pass, got, want) =>
    results.push({
      id,
      check: label,
      result: pass ? 'PASS' : 'FAIL',
      got: String(got),
      expected: want,
    });

  // --- Section A: size + color (theme-independent) ---------------
  const bubSize = parseFloat(cs('_p_byte').fontSize);
  const inSize = parseFloat(cs('_p_in').fontSize);
  add('A1', '.bub font-size', bubSize === EXPECT_SIZE, bubSize + 'px', EXPECT_SIZE + 'px');
  add('A2', '.composer-in font-size', inSize === EXPECT_SIZE, inSize + 'px', EXPECT_SIZE + 'px');
  add(
    'A3',
    '.bub color == --t-1',
    same(cs('_p_byte').color, cvar('--t-1')),
    cs('_p_byte').color,
    cvar('--t-1'),
  );
  add(
    'A4',
    '.composer-in color == --t-1',
    same(cs('_p_in').color, cvar('--t-1')),
    cs('_p_in').color,
    cvar('--t-1'),
  );

  // --- Section B: regression (colors preserved, layout intact) ---
  add(
    'B1',
    '.bub.me color == --t-2',
    same(cs('_p_me').color, cvar('--t-2')),
    cs('_p_me').color,
    cvar('--t-2'),
  );
  add(
    'B4',
    '.byte-thinking color == --t-3',
    same(cs('_p_think').color, cvar('--t-3')),
    cs('_p_think').color,
    cvar('--t-3'),
  );
  add(
    'B3',
    '.bub max-width == 94%',
    cs('_p_byte').maxWidth === '94%' ||
      Math.round(
        (parseFloat(cs('_p_byte').maxWidth) / host.querySelector('.cop-body').clientWidth) * 100,
      ) === 94,
    cs('_p_byte').maxWidth,
    '94%',
  );

  // --- Sections A5/A6: contrast in BOTH themes -------------------
  const prevTheme = root.getAttribute('data-theme');
  const themeReport = {};
  for (const theme of ['light', 'dark']) {
    root.setAttribute('data-theme', theme);
    const byteC = contrast(cvar('--t-1'), cvar('--surface')); // byte reply on bubble surface
    const meC = contrast(cvar('--t-2'), cvar('--accent-tint')); // user bubble on tint
    themeReport[theme] = { byte_on_surface: byteC, user_on_tint: meC };
    const tag = theme === 'light' ? 'A5' : 'A6';
    add(
      tag,
      `contrast ${theme}: byte-on-surface >= ${MIN_CONTRAST}`,
      byteC >= MIN_CONTRAST,
      byteC + ':1',
      `>= ${MIN_CONTRAST}:1`,
    );
    add(
      tag,
      `contrast ${theme}: user-on-tint >= ${MIN_CONTRAST}`,
      meC >= MIN_CONTRAST,
      meC + ':1',
      `>= ${MIN_CONTRAST}:1`,
    );
  }
  if (prevTheme === null) root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', prevTheme);

  host.remove();

  // --- verdict ---------------------------------------------------
  const failed = results.filter((r) => r.result === 'FAIL');
  const verdict = failed.length === 0 ? '✅ ALL PASS' : `❌ ${failed.length} FAILED`;
  console.log('%cCodepet chat readability audit — ' + verdict, 'font-weight:bold;font-size:13px');
  console.table(results);
  console.log('Contrast ratios:', themeReport);

  return {
    verdict,
    failed: failed.map((f) => f.id + ' ' + f.check),
    contrast: themeReport,
    results,
  };
})();
