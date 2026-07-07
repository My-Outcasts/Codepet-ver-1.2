import { describe, it, expect } from 'vitest';
import { examplePlanBanner } from './examplePlan';

describe('examplePlanBanner', () => {
  it('shows nothing once the plan is tailored (byte scaffold landed)', () => {
    expect(examplePlanBanner({ planTailored: true, scaffoldFailed: false })).toBeNull();
    // A prior failure is irrelevant once a real plan exists.
    expect(examplePlanBanner({ planTailored: true, scaffoldFailed: true })).toBeNull();
  });

  it('invites generation when the map is the example and nothing was attempted', () => {
    const b = examplePlanBanner({ planTailored: false, scaffoldFailed: false });
    expect(b).not.toBeNull();
    expect(b!.cta).toBe('Generate my plan');
    expect(b!.text.toLowerCase()).toContain('example');
    expect(b!.text).not.toContain('couldn’t reach'); // don't claim a failure that didn't happen
  });

  it('names the failure when a scaffold attempt couldn’t complete', () => {
    const b = examplePlanBanner({ planTailored: false, scaffoldFailed: true });
    expect(b).not.toBeNull();
    expect(b!.cta).toBe('Retry');
    expect(b!.text).toContain('couldn’t reach the model');
  });
});
