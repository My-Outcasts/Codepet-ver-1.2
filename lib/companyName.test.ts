import { describe, it, expect } from 'vitest';
import { cleanCompanyName } from './companyName';

describe('cleanCompanyName', () => {
  it('keeps a real company name', () => {
    expect(cleanCompanyName('Codepet')).toBe('Codepet');
    expect(cleanCompanyName('  Acme Robotics  ')).toBe('Acme Robotics');
  });

  it('rejects a raw signup email so the hero never shows a bare address', () => {
    expect(cleanCompanyName('pihet28405@ezimb.com')).toBeNull();
    expect(cleanCompanyName('jane.doe+test@gmail.com')).toBeNull();
  });

  it('rejects empty, single-char, and all-digit junk', () => {
    expect(cleanCompanyName('')).toBeNull();
    expect(cleanCompanyName('   ')).toBeNull();
    expect(cleanCompanyName('a')).toBeNull();
    expect(cleanCompanyName('1')).toBeNull();
    expect(cleanCompanyName('2024')).toBeNull();
    expect(cleanCompanyName(null)).toBeNull();
    expect(cleanCompanyName(undefined)).toBeNull();
  });

  it('keeps names that merely contain an @ but are not emails', () => {
    expect(cleanCompanyName('@acme')).toBe('@acme');
    expect(cleanCompanyName('Ben & Jerry')).toBe('Ben & Jerry');
  });
});
