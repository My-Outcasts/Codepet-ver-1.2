import { describe, it, expect } from 'vitest';
import { examplePlanBanner } from './examplePlan';

describe('examplePlanBanner', () => {
  it('shows nothing once the plan is tailored (byte scaffold landed)', () => {
    expect(examplePlanBanner({ planTailored: true, scaffoldFailure: null })).toBeNull();
    // A prior failure is irrelevant once a real plan exists.
    expect(examplePlanBanner({ planTailored: true, scaffoldFailure: 'network' })).toBeNull();
  });

  it('invites generation when the map is the example and nothing was attempted', () => {
    const b = examplePlanBanner({ planTailored: false, scaffoldFailure: null });
    expect(b).not.toBeNull();
    expect(b!.cta).toBe('Generate my plan');
    expect(b!.text.toLowerCase()).toContain('example');
    expect(b!.text).not.toContain('couldn’t'); // don't claim a failure that didn't happen
  });

  it('names a refused generation', () => {
    const b = examplePlanBanner({ planTailored: false, scaffoldFailure: 'refused' });
    expect(b).not.toBeNull();
    expect(b!.cta).toBe('Retry');
    expect(b!.text).toContain('couldn’t tailor this one');
    expect(b!.text).toContain('still an example');
  });

  it("incomplete cause → couldn't-finish copy + Retry", () => {
    const b = examplePlanBanner({ planTailored: false, scaffoldFailure: 'incomplete' });
    expect(b?.cta).toBe('Retry');
    expect(b?.text.toLowerCase()).toContain('finish');
  });

  it('names a rate-limited generation', () => {
    const b = examplePlanBanner({ planTailored: false, scaffoldFailure: 'rate_limited' });
    expect(b).not.toBeNull();
    expect(b!.cta).toBe('Retry');
    expect(b!.text).toContain('hit today’s limit');
    expect(b!.text).toContain('still an example');
  });

  it('falls back to the unreachable-model copy for any other failure cause', () => {
    for (const cause of ['ai_unavailable', 'network', 'empty', 'generation_failed']) {
      const b = examplePlanBanner({ planTailored: false, scaffoldFailure: cause });
      expect(b).not.toBeNull();
      expect(b!.cta).toBe('Retry');
      expect(b!.text).toContain('couldn’t reach the model');
    }
  });
});
