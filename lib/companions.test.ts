import { describe, it, expect } from 'vitest';
import { COMPANIONS, companionById, personaOverride } from './companions';

describe('companions registry', () => {
  it('has byte first as the default', () => {
    expect(COMPANIONS[0].id).toBe('byte');
  });

  it('has all seven characters', () => {
    expect(COMPANIONS.map((c) => c.id)).toEqual([
      'byte',
      'nova',
      'crash',
      'sage',
      'glitch',
      'luna',
      'null',
    ]);
  });

  it('resolves a known id', () => {
    expect(companionById('luna').name).toBe('Luna');
  });

  it('falls back to byte for unknown / missing ids', () => {
    expect(companionById('nope').id).toBe('byte');
    expect(companionById(undefined).id).toBe('byte');
    expect(companionById(null).id).toBe('byte');
  });

  it('gives byte no persona override, but names other companions', () => {
    expect(personaOverride('byte')).toBe('');
    const p = personaOverride('nova');
    expect(p).toContain('Nova');
    expect(p).toContain('first person');
  });
});
