import { describe, it, expect } from 'vitest';
import { serializeActiveBuild, parseActiveBuild } from './buildPersist';
import type { BytePlan } from './ai/plan';

const plan: BytePlan = {
  title: 'Login form',
  budgetK: 300,
  budgetActions: 12,
  steps: ['Scaffold', 'Wire up', 'Check'],
};

const snap = {
  companyId: 'co-1',
  buildSessionId: 'b-1',
  step: 'during' as const,
  project: 'my-app',
  projectDir: '/Users/me/my-app',
  brief: 'a login form',
  plan,
  autonomy: 'copilot' as const,
  local: true,
  launchCommand: null,
  checkpoint: { ref: 'abc123' },
  live: null,
};

describe('active-build snapshot', () => {
  it('round-trips through serialize/parse for the same company', () => {
    const parsed = parseActiveBuild(serializeActiveBuild(snap), 'co-1');
    expect(parsed).toMatchObject(snap);
  });

  it("never restores another company's build", () => {
    expect(parseActiveBuild(serializeActiveBuild(snap), 'co-2')).toBeNull();
  });

  it('rejects garbage, null, and malformed shapes', () => {
    expect(parseActiveBuild(null, 'co-1')).toBeNull();
    expect(parseActiveBuild('not json', 'co-1')).toBeNull();
    expect(parseActiveBuild('{}', 'co-1')).toBeNull();
    expect(
      parseActiveBuild(
        JSON.stringify({ ...JSON.parse(serializeActiveBuild(snap)), step: 'nope' }),
        'co-1',
      ),
    ).toBeNull();
    expect(
      parseActiveBuild(
        JSON.stringify({ ...JSON.parse(serializeActiveBuild(snap)), plan: { steps: 'x' } }),
        'co-1',
      ),
    ).toBeNull();
  });

  it('keeps the last live reading so the recap survives reload', () => {
    const withLive = {
      ...snap,
      live: {
        sessionId: 'sess-9',
        actionCount: 7,
        turns: 3,
        recentTools: ['ran a command'],
        startedAt: 1,
        lastTs: 2,
        ended: true,
      },
    };
    const parsed = parseActiveBuild(serializeActiveBuild(withLive), 'co-1');
    expect(parsed?.live?.actionCount).toBe(7);
    expect(parsed?.live?.sessionId).toBe('sess-9');
  });
});
