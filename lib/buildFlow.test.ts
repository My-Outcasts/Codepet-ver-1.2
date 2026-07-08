import { describe, it, expect } from 'vitest';
import {
  appendBrief,
  stepForLive,
  INTAKE_OPENING,
  INTAKE_FOLLOWUP,
  INTAKE_ENOUGH,
  briefLine,
  briefToText,
  scanOpening,
} from './buildFlow';

describe('appendBrief', () => {
  it('starts the brief with the first answer', () => {
    expect(appendBrief('', 'a todo app')).toBe('a todo app');
  });
  it('joins later answers with a newline', () => {
    expect(appendBrief('a todo app', 'for students')).toBe('a todo app\nfor students');
  });
  it('trims each answer and ignores blank ones', () => {
    expect(appendBrief('a todo app', '   ')).toBe('a todo app');
    expect(appendBrief('', '  hi  ')).toBe('hi');
  });
});

describe('stepForLive', () => {
  it('is "during" while the session is live or unknown', () => {
    expect(stepForLive(null)).toBe('during');
    expect(stepForLive({ ended: false })).toBe('during');
  });
  it('is "end" once the session has ended', () => {
    expect(stepForLive({ ended: true })).toBe('end');
  });
});

describe('intake copy', () => {
  it('provides a non-empty opening, follow-up, and enough line', () => {
    expect(INTAKE_OPENING.length).toBeGreaterThan(0);
    expect(INTAKE_FOLLOWUP.length).toBeGreaterThan(0);
    expect(INTAKE_ENOUGH.length).toBeGreaterThan(0);
  });

  it('the opening asks for the project first', () => {
    expect(INTAKE_OPENING.toLowerCase()).toContain('project');
  });
});

describe('scan-informed opener', () => {
  const brief = {
    frameworks: ['Next.js', 'TypeScript'],
    deps: ['stripe', 'firebase'],
    dirs: ['app'],
    readme: 'a saas starter',
  };

  it('briefLine names the stack and interesting deps', () => {
    const line = briefLine(brief);
    expect(line).toContain('Next.js + TypeScript');
    expect(line).toContain('stripe');
    expect(briefLine(null)).toBe('');
    expect(briefLine({})).toBe('');
  });

  it('briefToText renders a bounded prompt blob', () => {
    const t = briefToText(brief);
    expect(t).toContain('Stack: Next.js, TypeScript');
    expect(t).toContain('README: a saas starter');
    expect(t.length).toBeLessThanOrEqual(1200);
    expect(briefToText(null)).toBe('');
  });

  it('scanOpening mentions the project and the scan when available', () => {
    const withScan = scanOpening('my-app', brief);
    expect(withScan).toContain('my-app');
    expect(withScan).toContain('Next.js');
    const without = scanOpening('my-app', null);
    expect(without).toContain('my-app');
    expect(without).toContain('done');
  });
});
