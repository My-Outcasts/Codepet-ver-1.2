import { describe, it, expect } from 'vitest';
import {
  JUDGE_SCHEMA,
  DIMENSIONS,
  buildJudgePrompt,
  verdictAverage,
  verdictPasses,
  summarize,
  type Verdict,
} from './rubric';
import { GOLDEN_CASES } from './goldens';

const v = (grounded: number, specific: number, honest: number, actionable: number): Verdict => ({
  grounded,
  groundedWhy: '',
  specific,
  specificWhy: '',
  honest,
  honestWhy: '',
  actionable,
  actionableWhy: '',
});

describe('JUDGE_SCHEMA', () => {
  it('is strict (additionalProperties:false, every property required)', () => {
    const props = Object.keys(JUDGE_SCHEMA.properties as Record<string, unknown>);
    expect(JUDGE_SCHEMA.additionalProperties).toBe(false);
    expect((JUDGE_SCHEMA.required as string[]).sort()).toEqual(props.sort());
  });
  it('has a 1-5 score for every dimension', () => {
    const props = JUDGE_SCHEMA.properties as Record<string, { minimum?: number; maximum?: number }>;
    for (const d of DIMENSIONS) {
      expect(props[d].minimum).toBe(1);
      expect(props[d].maximum).toBe(5);
    }
  });
});

describe('buildJudgePrompt', () => {
  it('embeds the context, task, and the output under review', () => {
    const p = buildJudgePrompt(
      'Company is Codepet…',
      'Write the launch email',
      'email',
      'Hi Mona…',
    );
    expect(p).toContain('Codepet');
    expect(p).toContain('Write the launch email');
    expect(p).toContain('email');
    expect(p).toContain('Hi Mona');
  });
});

describe('verdictAverage / verdictPasses', () => {
  it('averages the four dimensions', () => {
    expect(verdictAverage(v(4, 4, 4, 4))).toBe(4);
    expect(verdictAverage(v(5, 3, 5, 3))).toBe(4);
  });
  it('passes when average and honesty both clear the threshold', () => {
    expect(verdictPasses(v(4, 4, 4, 4))).toBe(true);
    expect(verdictPasses(v(5, 5, 5, 5))).toBe(true);
  });
  it('FAILS a dishonest deliverable even when the rest is strong', () => {
    // grounded/specific/actionable all 5 but honest 2 → fabrication gate trips.
    expect(verdictPasses(v(5, 5, 2, 5))).toBe(false);
  });
  it('fails when the average is below threshold', () => {
    expect(verdictPasses(v(3, 3, 4, 3))).toBe(false);
  });
});

describe('summarize', () => {
  it('reports pass rate, per-dimension means, and the failing cases', () => {
    const s = summarize([
      { label: 'a', verdict: v(5, 5, 5, 5) },
      { label: 'b', verdict: v(5, 5, 2, 5) }, // dishonest → fails
      { label: 'c', verdict: v(4, 4, 4, 4) },
    ]);
    expect(s.n).toBe(3);
    expect(s.passed).toBe(2);
    expect(s.passRate).toBeCloseTo(2 / 3);
    expect(s.byDimension.honest).toBeCloseTo((5 + 2 + 4) / 3);
    expect(s.failures.map((f) => f.label)).toEqual(['b']);
  });
  it('handles an empty batch without dividing by zero', () => {
    const s = summarize([]);
    expect(s).toMatchObject({ n: 0, passed: 0, passRate: 0, overall: 0 });
  });
});

describe('GOLDEN_CASES', () => {
  it('every case has a unique id and a rich, grounded brief to judge against', () => {
    const ids = GOLDEN_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of GOLDEN_CASES) {
      expect(c.brief.projectName).toBeTruthy();
      // A meaningful "grounded" score needs real specifics in the brief.
      expect(c.brief.audience || c.brief.traction || c.brief.problem).toBeTruthy();
    }
  });
});
