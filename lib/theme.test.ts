import { describe, it, expect } from 'vitest';
import { accentVars } from './theme';

describe('accentVars', () => {
  it('returns the base accent unchanged in light, and lifts it in dark', () => {
    const light = accentVars('#7c3aed', 'light');
    expect(light['--accent']).toBe('#7c3aed');
    const dark = accentVars('#7c3aed', 'dark');
    // dark accent is the base mixed 22% toward white → strictly lighter than the base
    expect(dark['--accent']).not.toBe('#7c3aed');
    expect(parseInt(dark['--accent'].slice(1, 3), 16)).toBeGreaterThan(0x7c);
  });

  it('picks readable on-accent text by luminance (white on violet, dark on gold)', () => {
    expect(accentVars('#7c3aed', 'light')['--on-accent']).toBe('#ffffff'); // dark violet → white text
    expect(accentVars('#eab308', 'light')['--on-accent']).toBe('#160f26'); // bright gold → dark text
  });

  it('derives a light tint in light mode and a dark tint in dark mode', () => {
    const lightTint = accentVars('#7c3aed', 'light')['--accent-tint'];
    const darkTint = accentVars('#7c3aed', 'dark')['--accent-tint'];
    // light tint sits near white; dark tint sits near the charcoal surface
    expect(parseInt(lightTint.slice(1, 3), 16)).toBeGreaterThan(0xd0);
    expect(parseInt(darkTint.slice(1, 3), 16)).toBeLessThan(0x60);
  });

  it('always returns the full token set', () => {
    const keys = Object.keys(accentVars('#14b8a6', 'dark'));
    expect(keys).toEqual([
      '--accent',
      '--accent-deep',
      '--accent-tint',
      '--accent-line',
      '--on-accent',
    ]);
  });

  it('is deterministic', () => {
    expect(accentVars('#ec4899', 'dark')).toEqual(accentVars('#ec4899', 'dark'));
  });
});
