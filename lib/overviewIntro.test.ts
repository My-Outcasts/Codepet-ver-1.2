import { describe, it, expect } from 'vitest';
import {
  INTRO_SEEN_KEY,
  introInitialPhase,
  onReveal,
  onSettle,
  onReopen,
  revealAction,
} from './overviewIntro';

describe('overview first-run phase machine', () => {
  it('keeps the historical localStorage key', () => {
    expect(INTRO_SEEN_KEY).toBe('codepet:overview-intro-seen');
  });

  it('starts at intro only when the user has not seen it', () => {
    expect(introInitialPhase(false)).toBe('intro');
    expect(introInitialPhase(true)).toBe('done');
  });

  it('CTA reveals the spotlight, which settles to done', () => {
    expect(onReveal()).toBe('spotlight');
    expect(onSettle()).toBe('done');
  });

  it('reopen returns to the intro', () => {
    expect(onReopen()).toBe('intro');
  });
});

describe('revealAction', () => {
  it('flies to the beacon when there is a live next move', () => {
    expect(revealAction({ dept: { k: 'eng' }, task: { t: 'x' } })).toBe('fly');
  });

  it('recenters the map when there is no next move', () => {
    expect(revealAction(null)).toBe('recenter');
  });
});
