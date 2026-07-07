import { describe, it, expect } from 'vitest';
import { shouldPromptInstall } from './installPrompt';

const ready = { hydrated: true, onboarding: false, installed: false, prompted: false };

describe('shouldPromptInstall', () => {
  it('opens for a hydrated, un-onboarded-free, uninstalled, unprompted app', () => {
    expect(shouldPromptInstall(ready)).toBe(true);
  });

  it('never opens before hydration', () => {
    expect(shouldPromptInstall({ ...ready, hydrated: false })).toBe(false);
  });

  it('never pops over onboarding', () => {
    expect(shouldPromptInstall({ ...ready, onboarding: true })).toBe(false);
  });

  it('never opens once installed', () => {
    expect(shouldPromptInstall({ ...ready, installed: true })).toBe(false);
  });

  it('auto-shows only once — a prompted flag blocks it', () => {
    expect(shouldPromptInstall({ ...ready, prompted: true })).toBe(false);
  });
});
