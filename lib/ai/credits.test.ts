import { describe, it, expect } from 'vitest';
import {
  CREDIT_COSTS,
  creditCostForRoute,
  canAffordBuild,
  PRO_INCLUDED_CREDITS,
  OVERAGE_USD_PER_CREDIT,
  creditsRemaining,
  overTrialAllowance,
  overageCredits,
  overageUsd,
} from './credits';

describe('creditCostForRoute', () => {
  it('charges chat the cheap rate', () => {
    expect(creditCostForRoute('chat')).toBe(CREDIT_COSTS.chat);
    expect(creditCostForRoute('chat')).toBeLessThan(CREDIT_COSTS.light);
  });

  it('charges extraction/selection routes the light rate', () => {
    for (const key of ['nextStep', 'memory', 'enrich', 'enrichAnswer']) {
      expect(creditCostForRoute(key)).toBe(CREDIT_COSTS.light);
    }
  });

  it('charges scaffold the medium rate and deliverables the heavy rate', () => {
    expect(creditCostForRoute('scaffold')).toBe(CREDIT_COSTS.medium);
    expect(creditCostForRoute('runTask')).toBe(CREDIT_COSTS.heavy);
    expect(creditCostForRoute('personalize')).toBe(CREDIT_COSTS.heavy);
  });

  it('falls back to light for an unknown route (never silently free)', () => {
    expect(creditCostForRoute('brandNewRoute')).toBe(CREDIT_COSTS.light);
    expect(creditCostForRoute('')).toBe(CREDIT_COSTS.light);
  });

  it('keeps the intended relative ordering chat < light < medium < heavy', () => {
    expect(CREDIT_COSTS.chat).toBeLessThan(CREDIT_COSTS.light);
    expect(CREDIT_COSTS.light).toBeLessThan(CREDIT_COSTS.medium);
    expect(CREDIT_COSTS.medium).toBeLessThan(CREDIT_COSTS.heavy);
  });
});

describe('creditsRemaining', () => {
  it('returns what is left in the allowance', () => {
    expect(creditsRemaining(300, PRO_INCLUDED_CREDITS)).toBe(500);
    expect(creditsRemaining(0, PRO_INCLUDED_CREDITS)).toBe(PRO_INCLUDED_CREDITS);
  });

  it('clamps at zero once spent past the allowance', () => {
    expect(creditsRemaining(900, PRO_INCLUDED_CREDITS)).toBe(0);
  });
});

describe('overTrialAllowance (hard-stop)', () => {
  it('allows while under the allowance and blocks at/after it', () => {
    expect(overTrialAllowance(149, 150)).toBe(false);
    expect(overTrialAllowance(150, 150)).toBe(true);
    expect(overTrialAllowance(151, 150)).toBe(true);
  });
});

describe('Pro overage (billed, not blocked)', () => {
  it('is zero within the included allowance', () => {
    expect(overageCredits(500, PRO_INCLUDED_CREDITS)).toBe(0);
    expect(overageUsd(800, PRO_INCLUDED_CREDITS)).toBe(0);
  });

  it('counts and prices credits beyond the allowance', () => {
    expect(overageCredits(900, PRO_INCLUDED_CREDITS)).toBe(100);
    expect(overageUsd(900, PRO_INCLUDED_CREDITS)).toBeCloseTo(100 * OVERAGE_USD_PER_CREDIT);
  });
});

describe('build credits', () => {
  it('prices a build at 5 credits', () => {
    expect(creditCostForRoute('build')).toBe(5);
  });
  it('can afford when remaining allowance >= cost', () => {
    expect(canAffordBuild(795, 800)).toBe(true); // 5 remaining, cost 5
    expect(canAffordBuild(796, 800)).toBe(false); // 4 remaining
    expect(canAffordBuild(0, 800)).toBe(true);
  });
  it('cannot afford with no allowance', () => {
    expect(canAffordBuild(0, 0)).toBe(false);
  });
});
