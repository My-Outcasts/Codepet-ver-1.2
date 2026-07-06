import { describe, it, expect } from 'vitest';
import { briefToContext } from './brief';

describe('briefToContext', () => {
  it('returns null when there is no product signal', () => {
    expect(briefToContext(null)).toBeNull();
    expect(briefToContext({ role: 'founder' })).toBeNull();
  });

  it('uses the one-liner + raw notes when byte has not enriched yet', () => {
    const ctx = briefToContext({
      projectName: 'Codepet',
      oneLiner: 'a recap tool',
      notes: 'reads sessions',
    });
    expect(ctx).toContain('a recap tool.');
    expect(ctx).toContain('reads sessions.');
  });

  it("uses byte's summary and DROPS the overlapping one-liner + notes (no triple description)", () => {
    const ctx =
      briefToContext({
        projectName: 'Codepet',
        oneLiner: 'a recap tool',
        summary: 'A local-first macOS companion that recaps coding sessions.',
        notes: 'reads sessions and builds a dictionary',
      }) ?? '';
    // The enriched summary is present…
    expect(ctx).toContain('A local-first macOS companion that recaps coding sessions.');
    // …and it replaces the one-liner and raw notes rather than stacking them.
    expect(ctx).not.toContain('a recap tool.');
    expect(ctx).not.toContain('reads sessions and builds a dictionary');
  });

  it('still includes structured fields (categories, audience) alongside the summary', () => {
    const ctx =
      briefToContext({
        projectName: 'Codepet',
        summary: 'A recap companion.',
        categories: ['macOS app', 'dev tool'],
        audience: 'AI-first developers',
      }) ?? '';
    expect(ctx).toContain('macos app / dev tool');
    expect(ctx).toContain("It's for AI-first developers.");
  });

  it('threads the plan-shaping enrichment fields (goal, traction, problem) into context', () => {
    const ctx =
      briefToContext({
        projectName: 'Codepet',
        summary: 'A recap companion.',
        goal: 'Ship the macOS beta in 3 weeks',
        traction: '300 on the waitlist, not launched yet',
        problem: 'Devs lose context between coding sessions',
      }) ?? '';
    expect(ctx).toContain('Their immediate goal: Ship the macOS beta in 3 weeks.');
    expect(ctx).toContain('Where they are now: 300 on the waitlist, not launched yet.');
    expect(ctx).toContain('The problem it solves: Devs lose context between coding sessions.');
  });

  it('omits enrichment lines that are still empty', () => {
    const ctx = briefToContext({ projectName: 'Codepet', summary: 'A recap companion.' }) ?? '';
    expect(ctx).not.toContain('immediate goal');
    expect(ctx).not.toContain('Where they are now');
    expect(ctx).not.toContain('problem it solves');
  });
});
