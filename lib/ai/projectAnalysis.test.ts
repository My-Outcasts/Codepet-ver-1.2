import { describe, it, expect } from 'vitest';
import {
  isUsableAnalysis,
  analysisRows,
  analysisPrompt,
  PROJECT_ANALYSIS_SCHEMA,
  type ProjectAnalysis,
} from './projectAnalysis';

const full: ProjectAnalysis = {
  overall: 'Proven product, clear edge, one step from launch — activation is the gap.',
  building: 'An AI coding companion for solo founders.',
  stage: 'Launch stage, pre-revenue.',
  edge: 'The guided one-move-at-a-time map.',
  watchOut: 'First-run activation.',
  focusNow: 'Design + Engineering first, Marketing close behind.',
};

describe('isUsableAnalysis', () => {
  it('accepts a full six-field object', () => {
    expect(isUsableAnalysis(full)).toBe(true);
  });
  it('rejects when any field is missing (including overall)', () => {
    for (const k of Object.keys(full) as (keyof ProjectAnalysis)[]) {
      const partial = { ...full };
      delete partial[k];
      expect(isUsableAnalysis(partial)).toBe(false);
    }
  });
  it('rejects empty or whitespace-only fields', () => {
    expect(isUsableAnalysis({ ...full, edge: '' })).toBe(false);
    expect(isUsableAnalysis({ ...full, overall: '   ' })).toBe(false);
  });
  it('rejects non-string fields and non-objects', () => {
    expect(isUsableAnalysis({ ...full, stage: 3 })).toBe(false);
    expect(isUsableAnalysis(null)).toBe(false);
    expect(isUsableAnalysis('nope')).toBe(false);
  });
});

describe('analysisRows', () => {
  it('returns the five labeled rows (overall excluded — it is the lead paragraph)', () => {
    const rows = analysisRows(full);
    expect(rows.map((r) => r.label)).toEqual([
      "You're building",
      'Where you are',
      'Your edge',
      'Watch out',
      'Focus now',
    ]);
    expect(rows.map((r) => r.value)).toEqual([
      full.building,
      full.stage,
      full.edge,
      full.watchOut,
      full.focusNow,
    ]);
    expect(rows.map((r) => r.value)).not.toContain(full.overall);
  });
});

describe('analysisPrompt / schema', () => {
  it('embeds the context', () => {
    expect(analysisPrompt('CONTEXT_SENTINEL')).toContain('CONTEXT_SENTINEL');
  });
  it('asks for the synthesized overall read', () => {
    expect(analysisPrompt('x')).toContain('overall');
  });
  it('schema requires all six fields (overall first) and forbids extras', () => {
    expect(PROJECT_ANALYSIS_SCHEMA.additionalProperties).toBe(false);
    expect(PROJECT_ANALYSIS_SCHEMA.required).toEqual([
      'overall',
      'building',
      'stage',
      'edge',
      'watchOut',
      'focusNow',
    ]);
  });
});
