import { describe, it, expect } from 'vitest';
import { cleanCompanyName, meaningfulText, normalizeBrief } from './companyName';

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

describe('meaningfulText', () => {
  it('keeps text with real signal (trimmed)', () => {
    expect(meaningfulText('  A recap companion for coders  ')).toBe('A recap companion for coders');
  });
  it('drops empty, too-short, or all-digit text', () => {
    expect(meaningfulText('')).toBeNull();
    expect(meaningfulText('  ')).toBeNull();
    expect(meaningfulText('hi')).toBeNull(); // < 6 chars
    expect(meaningfulText('123456')).toBeNull(); // all digits
    expect(meaningfulText(null)).toBeNull();
    expect(meaningfulText(undefined)).toBeNull();
  });
  it('respects a custom minimum length', () => {
    expect(meaningfulText('Acme', 3)).toBe('Acme');
    expect(meaningfulText('Acme', 10)).toBeNull();
  });
});

describe('normalizeBrief', () => {
  it('trims fields, drops empties, and nulls a junk company name', () => {
    const out = normalizeBrief({
      founderName: '  Jane  ',
      projectName: 'pihet28405@ezimb.com', // raw signup email → dropped
      oneLiner: '  A tool for founders ',
      summary: '   ', // whitespace-only → dropped
      audience: 'Solo founders',
      categories: ['  SaaS ', '', '  Dev tool'],
    });
    expect(out.founderName).toBe('Jane');
    expect(out.projectName).toBeUndefined(); // email is not a company name
    expect(out.oneLiner).toBe('A tool for founders');
    expect(out.summary).toBeUndefined();
    expect(out.audience).toBe('Solo founders');
    expect(out.categories).toEqual(['SaaS', 'Dev tool']); // trimmed, empties removed
  });

  it('preserves a real company name and leaves an empty brief empty', () => {
    expect(normalizeBrief({ projectName: 'Codepet' }).projectName).toBe('Codepet');
    const empty = normalizeBrief({});
    expect(empty.projectName).toBeUndefined();
    expect(empty.oneLiner).toBeUndefined();
  });

  it('is idempotent — normalizing twice equals normalizing once', () => {
    const brief = {
      founderName: '  Mona ',
      projectName: '  Murror ',
      oneLiner: '  Work log companion ',
      notes: '2024', // all-digit note is not a name field → trimmed but kept
    };
    const once = normalizeBrief(brief);
    expect(normalizeBrief(once)).toEqual(once);
  });
});
