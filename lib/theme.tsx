'use client';
// The theming layer — light / dark, driven through the CSS custom properties the whole app
// already reads (--page, --surface, --t-1, --accent, …): a `data-theme` attribute on <html>
// flips the token override block in globals.css. Preference is `system` (follow the OS),
// `light`, or `dark`; `system` tracks prefers-color-scheme live. Persisted in localStorage; a
// no-FOUC script in app/layout.tsx sets the attribute before first paint so there's no flash.
// (`accentVars` derives an accent token set from a base colour; retained for tests. The app no
// longer re-tints per companion — accent stays at the brand default, voice is per-department.)
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'codepet-theme';
const DARK_MQ = '(prefers-color-scheme: dark)';

function readPref(): ThemePref {
  if (typeof window === 'undefined') return 'system';
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* private mode / disabled storage — fall through to system */
  }
  return 'system';
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(DARK_MQ).matches;
}

interface ThemeCtx {
  pref: ThemePref;
  resolved: ResolvedTheme;
  setPref: (p: ThemePref) => void;
}

const Ctx = createContext<ThemeCtx>({ pref: 'system', resolved: 'light', setPref: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Lazy initializers read the real values on the client's first render, so `resolved` already
  // matches what the no-FOUC script set — no flash, no override on mount. On the server both
  // return their defaults; nothing theme-dependent is rendered, so there's no hydration mismatch.
  const [pref, setPrefState] = useState<ThemePref>(readPref);
  const [sysDark, setSysDark] = useState<boolean>(systemPrefersDark);

  // Track OS changes while the preference is `system`. `sysDark` is lazy-initialised from the
  // same media query, so we only subscribe here — no synchronous set-state in the effect body.
  useEffect(() => {
    const mq = window.matchMedia(DARK_MQ);
    const onChange = (e: MediaQueryListEvent) => setSysDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved: ResolvedTheme = pref === 'system' ? (sysDark ? 'dark' : 'light') : pref;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    try {
      window.localStorage.setItem(STORAGE_KEY, p);
    } catch {
      /* ignore — the in-memory state still drives this session */
    }
  }, []);

  return <Ctx.Provider value={{ pref, resolved, setPref }}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  return useContext(Ctx);
}

// ---- colour maths (pure) -------------------------------------------------------------------
// Small linear-RGB helpers so a single signature colour per companion derives every accent
// token consistently for both themes. Kept dependency-free.

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const s = hex.replace('#', '');
  const full = s.length === 3 ? s.replace(/./g, (c) => c + c) : s;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function rgbToHex([r, g, b]: RGB): string {
  const h = (x: number) =>
    Math.round(Math.max(0, Math.min(255, x)))
      .toString(16)
      .padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Linear blend: t=0 → a, t=1 → b. */
function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}

/** WCAG relative luminance (0 = black, 1 = white). */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const WHITE = '#ffffff';
const BLACK = '#000000';
// The two surfaces the accent tints sit on, per theme (must track globals.css --surface).
const DARK_SURFACE = '#1b1712';

/**
 * Derive the full accent token set from one signature colour. In dark mode the base is lifted
 * toward white for punch on the charcoal ground; tint/line are mixed toward the theme's surface;
 * --on-accent picks black or white text by the accent's luminance so labels stay readable on any
 * companion colour in either theme.
 */
export function accentVars(baseLight: string, theme: ResolvedTheme): Record<string, string> {
  const accent = theme === 'dark' ? mix(baseLight, WHITE, 0.22) : baseLight;
  const surface = theme === 'dark' ? DARK_SURFACE : WHITE;
  return {
    '--accent': accent,
    '--accent-deep': mix(accent, BLACK, 0.18),
    '--accent-tint': theme === 'dark' ? mix(accent, surface, 0.82) : mix(accent, WHITE, 0.88),
    '--accent-line': theme === 'dark' ? mix(accent, surface, 0.62) : mix(accent, WHITE, 0.6),
    '--on-accent': luminance(accent) > 0.42 ? '#160f26' : WHITE,
  };
}
