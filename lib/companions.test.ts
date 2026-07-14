import { describe, it, expect } from 'vitest';
import { COMPANIONS, companionById, companionForDept, personaOverride } from './companions';

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

describe('companionForDept', () => {
  it('maps each department to its pet', () => {
    expect(companionForDept('eng').id).toBe('byte');
    expect(companionForDept('sales').id).toBe('crash');
    expect(companionForDept('mkt').id).toBe('nova');
    expect(companionForDept('design').id).toBe('glitch');
    expect(companionForDept('ops').id).toBe('sage');
    expect(companionForDept('support').id).toBe('luna');
  });

  it('shares Null across Finance and Legal', () => {
    expect(companionForDept('fin').id).toBe('null');
    expect(companionForDept('legal').id).toBe('null');
  });

  it('falls back to byte for unknown / missing department keys', () => {
    expect(companionForDept('nope').id).toBe('byte');
    expect(companionForDept(undefined).id).toBe('byte');
    expect(companionForDept(null).id).toBe('byte');
    expect(companionForDept('').id).toBe('byte');
  });
});
